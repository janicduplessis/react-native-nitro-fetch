package com.margelo.nitro.nitrofetch

import java.io.IOException
import java.net.URL
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSession
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509TrustManager

/**
 * Requests with a `trust` option. Cronet has no API to replace certificate verification
 * per request, so these go through [HttpsURLConnection] with a trust manager and hostname
 * verifier that accept only the pinned leaf certificates. Each pin set gets its own
 * [SSLContext], so its connections and TLS sessions are never shared with other requests.
 */
internal object PinnedFetch {
  private const val MAX_REDIRECTS = 20
  private const val PIN_MISMATCH = "The server certificate does not match the pinned SHA-256 fingerprints"

  private class Pinning(val socketFactory: SSLSocketFactory, val hostnameVerifier: HostnameVerifier)

  private val pinnings = ConcurrentHashMap<Set<String>, Pinning>()

  fun parsePins(trust: NitroRequestTrust): Set<String> {
    val pins = trust.certificateSha256.map { fingerprint ->
      val hex = fingerprint.replace(":", "").lowercase()
      require(hex.length == 64 && hex.all { it in '0'..'9' || it in 'a'..'f' }) {
        "Invalid certificate SHA-256 fingerprint: $fingerprint"
      }
      hex
    }.toSet()
    require(pins.isNotEmpty()) { "trust.certificateSha256 must list at least one fingerprint" }
    return pins
  }

  private fun sha256Hex(certificate: java.security.cert.Certificate): String =
    MessageDigest.getInstance("SHA-256").digest(certificate.encoded)
      .joinToString("") { "%02x".format(it.toInt() and 0xFF) }

  private fun pinning(pins: Set<String>): Pinning = pinnings.getOrPut(pins) {
    val trustManager = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
        throw CertificateException("Client certificates are not supported")
      }

      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        val leaf = chain.firstOrNull() ?: throw CertificateException("The server sent no certificate")
        if (sha256Hex(leaf) !in pins) throw CertificateException(PIN_MISMATCH)
      }

      override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf(trustManager), null)
    // The pin replaces the hostname check; this re-checks the pin on the established session.
    val hostnameVerifier = HostnameVerifier { _: String, session: SSLSession ->
      val leaf = try { session.peerCertificates.firstOrNull() } catch (_: IOException) { null }
      leaf != null && sha256Hex(leaf) in pins
    }
    Pinning(context.socketFactory, hostnameVerifier)
  }

  /** Starts [req] on [executor] and returns a function that cancels it. */
  fun start(
    req: NitroRequest,
    pins: Set<String>,
    body: ByteArray?,
    bodyContentType: String?,
    executor: Executor,
    onSuccess: (NitroResponse) -> Unit,
    onFail: (Throwable) -> Unit
  ): () -> Unit {
    val canceled = AtomicBoolean(false)
    val current = AtomicReference<HttpsURLConnection?>()
    executor.execute {
      try {
        onSuccess(perform(req, pins, body, bodyContentType, canceled) { current.set(it) })
      } catch (t: Throwable) {
        onFail(if (canceled.get()) RuntimeException("Request canceled") else t)
      }
    }
    return {
      canceled.set(true)
      current.get()?.disconnect()
    }
  }

  private fun perform(
    req: NitroRequest,
    pins: Set<String>,
    initialBody: ByteArray?,
    bodyContentType: String?,
    canceled: AtomicBoolean,
    onConnection: (HttpsURLConnection) -> Unit
  ): NitroResponse {
    val pinning = pinning(pins)
    val omitCredentials = req.credentials == NitroRequestCredentials.OMIT
    val followRedirects = req.followRedirects ?: true
    val timeoutMs = req.timeoutMs?.toInt()?.takeIf { it > 0 } ?: 0
    val headers = req.headers
      ?.filterNot { it.key.equals("prefetchKey", ignoreCase = true) }
      ?.toMutableList() ?: mutableListOf()
    var method = req.method?.name ?: "GET"
    var body = initialBody
    var url = URL(req.url)
    var storedCookies = false

    for (hop in 0..MAX_REDIRECTS) {
      if (!url.protocol.equals("https", ignoreCase = true)) {
        throw IOException("Certificate pinning requires an https:// URL: $url")
      }
      if (canceled.get()) throw IOException("Request canceled")
      val conn = url.openConnection() as HttpsURLConnection
      onConnection(conn)
      try {
        conn.sslSocketFactory = pinning.socketFactory
        conn.hostnameVerifier = pinning.hostnameVerifier
        conn.instanceFollowRedirects = false
        conn.useCaches = false
        conn.connectTimeout = timeoutMs
        conn.readTimeout = timeoutMs
        conn.requestMethod = method
        headers.forEach { conn.addRequestProperty(it.key, it.value) }
        if (body != null && bodyContentType != null) conn.setRequestProperty("Content-Type", bodyContentType)
        if (!omitCredentials) {
          NitroCookieSync.attachCookieFromManagerIfMissing(
            url.toString(),
            NitroCookieSync.hasCookieHeaderInNitroRequest(req.headers)
          ) { key, value -> conn.setRequestProperty(key, value) }
        }
        body?.let { bytes ->
          conn.doOutput = true
          conn.setFixedLengthStreamingMode(bytes.size)
          conn.outputStream.use { it.write(bytes) }
        }

        val status = conn.responseCode
        if (!omitCredentials &&
          NitroCookieSync.storeSetCookieFromHttpURLConnection(url.toString(), conn, flush = false)
        ) {
          storedCookies = true
        }
        val location = conn.getHeaderField("Location")
        if (status in 300..399 && location != null && status != 304) {
          if (!followRedirects) {
            if (storedCookies) NitroCookieSync.flushCookieManager()
            return response(conn, url.toString(), status, redirected = false, bytes = ByteArray(0))
          }
          if (hop == MAX_REDIRECTS) throw IOException("Too many redirects")
          val next = URL(url, location)
          if (status == 303 && method != "HEAD" || (status == 301 || status == 302) && method == "POST") {
            method = "GET"
            body = null
          }
          if (!next.protocol.equals(url.protocol, ignoreCase = true) ||
            !next.host.equals(url.host, ignoreCase = true) || next.port != url.port
          ) {
            headers.removeAll { it.key.equals("Authorization", ignoreCase = true) }
          }
          url = next
          continue
        }

        val noBody = method == "HEAD" || status == 204 || status == 205 || status == 304
        val bytes = if (noBody) ByteArray(0) else {
          val stream = if (status >= 400) conn.errorStream else conn.inputStream
          stream?.use { it.readBytes() } ?: ByteArray(0)
        }
        if (storedCookies) NitroCookieSync.flushCookieManager()
        return response(conn, url.toString(), status, redirected = url.toString() != req.url, bytes = bytes)
      } finally {
        conn.disconnect()
      }
    }
    throw IOException("Too many redirects")
  }

  private fun response(
    conn: HttpsURLConnection,
    url: String,
    status: Int,
    redirected: Boolean,
    bytes: ByteArray
  ): NitroResponse {
    val headers = conn.headerFields.flatMap { (key, values) ->
      if (key == null) emptyList() else values.map { NitroHeader(key, it) }
    }.toTypedArray()
    val bodyString = try {
      decodeText(bytes, bytes.size, charsetOf(conn.contentType ?: ""))
    } catch (_: Throwable) {
      null
    }
    return NitroResponse(
      url = url,
      status = status.toDouble(),
      statusText = conn.responseMessage ?: "",
      ok = status in 200..299,
      redirected = redirected,
      headers = headers,
      bodyString = bodyString,
      bodyBytes = if (bodyString == null && bytes.isNotEmpty()) bytes.toArrayBuffer() else null
    )
  }
}
