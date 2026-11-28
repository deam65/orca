package expo.modules.orcamobilewebshell

/** CSP belongs only on the document response; it is inert on subresources. WebResourceResponse takes MIME/encoding separately. */
internal fun mobileWebShellResponseHeaders(path: String, byteCount: Int): Map<String, String> {
  val cacheControl =
    if (path.startsWith("/__orca_screencast/")) "private, max-age=60, immutable" else "no-store"
  val headers = mutableMapOf(
    "Content-Length" to byteCount.toString(),
    "Cache-Control" to cacheControl,
    "X-Content-Type-Options" to "nosniff"
  )
  if (path == "/") {
    headers["Content-Security-Policy"] = MOBILE_WEB_SHELL_CSP
    // HTTPS images can expose session identity: Android uses a hashed host, iOS the verbatim id.
    // WebKit srcdoc images leaked the embedder origin despite iframe referrerPolicy; set the document header.
    headers["Referrer-Policy"] = "no-referrer"
  } else if (path == MOBILE_WEB_SHELL_CHAT_VISUAL_FRAME_PATH) {
    headers["Content-Security-Policy"] = MOBILE_WEB_SHELL_CHAT_VISUAL_FRAME_CSP
    headers["Referrer-Policy"] = "no-referrer"
  }
  return headers
}
