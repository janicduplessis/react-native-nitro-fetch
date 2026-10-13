//
//  LwsContext.hpp
//  Pods
//
//  Created by Ritesh Shukla on 20.03.26.
//

#pragma once

#include <libwebsockets.h>
#include <thread>
#include <atomic>
#include <mutex>
#include <vector>
#include <functional>

namespace margelo::nitro::nitrofetchwebsockets {


int nitroWsCallback(lws* wsi, enum lws_callback_reasons reason,
                    void* user, void* in, size_t len);

} // namespace margelo::nitro::nitrofetchwebsockets


namespace margelo::nitro::nitrofetchwebsockets {


class LwsContext {
public:
  static LwsContext& instance();

  lws_context* ctx() const { return _ctx; }

  // For connections that verify a pinned certificate themselves. It keeps no
  // TLS session cache, so a pinned handshake is never resumed by, or resumes,
  // another connection. Created on first use; call on the service thread.
  lws_vhost* pinnedVhost();


  void schedule(std::function<void()> op);


  void wakeup();

private:
  LwsContext();
  ~LwsContext();

  // Non-copyable / non-movable singleton
  LwsContext(const LwsContext&) = delete;
  LwsContext& operator=(const LwsContext&) = delete;

  void loop();

  lws_context* _ctx = nullptr;
  lws_vhost* _pinnedVhost = nullptr;
  lws_context_creation_info _info = {};
  std::thread _serviceThread;
  std::atomic<bool> _running{true};
  std::mutex _mu;
  std::vector<std::function<void()>> _pending;
};

} // namespace margelo::nitro::nitrofetchwebsockets
