/* WebSocket 客户端：自动重连，重连成功后由调用方重新声明身份 */

export function connect({ onMessage, onOpen, onClose }) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/party/ws`;
  let ws = null;
  let retry = 0;
  let retryTimer = 0;
  let stopped = false;

  function open() {
    clearTimeout(retryTimer);
    const socket = new WebSocket(url);
    ws = socket;
    socket.onopen = () => {
      retry = 0;
      onOpen && onOpen();
    };
    socket.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      onMessage(msg);
    };
    socket.onclose = (e) => {
      if (socket !== ws) return; // 已被新连接取代
      onClose && onClose(e);
      // 4000 = 同一身份在别处登录，不再重连
      if (stopped || e.code === 4000) return;
      retryTimer = setTimeout(open, Math.min(500 * 2 ** retry++, 4000));
    };
  }
  open();

  // 从后台切回前台时，连接可能已被系统掐断，跳过退避立即重连
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !stopped && ws.readyState === WebSocket.CLOSED) {
      retry = 0;
      open();
    }
  });

  return {
    send(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    },
    close() {
      stopped = true;
      ws && ws.close();
    },
  };
}

