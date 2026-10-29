// Abort optional evidence calls when the client disconnects. Normal completion
// must not be treated as a cancellation.
export function requestSignal(req, res) {
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); cleanup(); };
  const cleanup = () => {
    req.removeListener?.('aborted', abort);
    res.removeListener?.('close', abort);
  };
  req.once?.('aborted', abort);
  res.once?.('close', abort);
  res.once?.('finish', cleanup);
  return controller.signal;
}
