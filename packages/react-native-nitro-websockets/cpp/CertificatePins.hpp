#pragma once

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <optional>
#include <string>
#include <vector>

namespace margelo::nitro::nitrofetchwebsockets {

using CertificateSha256 = std::array<uint8_t, 32>;

// SHA-256 digests of the DER leaf certificates a connection accepts. Empty means
// the platform's default certificate validation.
using CertificatePins = std::vector<CertificateSha256>;

// Parses 64 hex digits, case-insensitive, with optional ':' separators.
inline std::optional<CertificateSha256> parseCertificateSha256(const std::string& text) {
  CertificateSha256 digest{};
  size_t digits = 0;
  for (char c : text) {
    if (c == ':') continue;
    int value;
    if (c >= '0' && c <= '9') value = c - '0';
    else if (c >= 'a' && c <= 'f') value = c - 'a' + 10;
    else if (c >= 'A' && c <= 'F') value = c - 'A' + 10;
    else return std::nullopt;
    if (digits >= 64) return std::nullopt;
    digest[digits / 2] = static_cast<uint8_t>(digest[digits / 2] | (value << (digits % 2 == 0 ? 4 : 0)));
    digits++;
  }
  if (digits != 64) return std::nullopt;
  return digest;
}

inline bool matchesCertificatePin(const CertificatePins& pins, const uint8_t* digest) {
  return std::any_of(pins.begin(), pins.end(), [digest](const CertificateSha256& pin) {
    return std::memcmp(pin.data(), digest, pin.size()) == 0;
  });
}

} // namespace margelo::nitro::nitrofetchwebsockets
