package expo.modules.orcamobilewebshell

import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

internal data class MobileWebShellScreencastFrameEntry(
  val streamId: String,
  val frameSeq: Int,
  val mimeType: String,
  val bytes: ByteArray
)

/** Thread-safe bounded RAM store for screencast frames served at /__orca_screencast/<streamId>/<frameSeq>. */
internal class MobileWebShellScreencastFrameStore(
  private val maxFramesPerStream: Int = 12,
  private val maxStreams: Int = 8,
  private val maxFrameBytes: Int = 8 * 1024 * 1024,
  private val maxTotalBytes: Int = 16 * 1024 * 1024
) {
  private val lock = ReentrantLock()
  private val streams = LinkedHashMap<String, ArrayList<MobileWebShellScreencastFrameEntry>>()
  private var totalBytes = 0

  fun stage(streamId: String, frameSeq: Int, mimeType: String, bytes: ByteArray): String? {
    if (mimeType != "image/jpeg" && mimeType != "image/png") return null
    if (bytes.isEmpty() || bytes.size > maxFrameBytes) return null

    val path = "/__orca_screencast/$streamId/$frameSeq"
    if (parsePath(path) == null) return null

    return lock.withLock {
      val entry = MobileWebShellScreencastFrameEntry(streamId, frameSeq, mimeType, bytes)
      val frames = streams[streamId] ?: ArrayList<MobileWebShellScreencastFrameEntry>().also {
        streams[streamId] = it
      }

      val existingIdx = frames.indexOfFirst { it.frameSeq == frameSeq }
      if (existingIdx != -1) {
        totalBytes -= frames[existingIdx].bytes.size
        frames[existingIdx] = entry
      } else {
        frames.add(entry)
        while (frames.size > maxFramesPerStream) {
          totalBytes -= frames.removeAt(0).bytes.size
        }
      }

      streams.remove(streamId)
      streams[streamId] = frames
      while (streams.size > maxStreams) {
        val oldestKey = streams.keys.iterator().next()
        streams.remove(oldestKey)?.forEach { totalBytes -= it.bytes.size }
      }

      totalBytes += bytes.size
      while (totalBytes > maxTotalBytes && streams.isNotEmpty()) {
        val oldestKey = streams.keys.iterator().next()
        val oldestFrames = streams[oldestKey]
        if (oldestFrames != null && oldestFrames.isNotEmpty()) {
          totalBytes -= oldestFrames.removeAt(0).bytes.size
          if (oldestFrames.isEmpty()) streams.remove(oldestKey)
        } else {
          streams.remove(oldestKey)
        }
      }

      path
    }
  }

  fun read(path: String): MobileWebShellScreencastFrameEntry? {
    val parsed = parsePath(path) ?: return null
    return lock.withLock {
      streams[parsed.first]?.firstOrNull { it.frameSeq == parsed.second }
    }
  }

  fun clearStream(streamId: String) {
    lock.withLock {
      streams.remove(streamId)?.forEach { totalBytes -= it.bytes.size }
    }
  }

  fun clearAll() {
    lock.withLock {
      streams.clear()
      totalBytes = 0
    }
  }

  companion object {
    private const val PREFIX = "/__orca_screencast/"

    fun parsePath(path: String): Pair<String, Int>? {
      if (!path.startsWith(PREFIX)) return null
      val parts = path.substring(PREFIX.length).split("/")
      if (parts.size != 2) return null
      val streamId = parts[0]
      val frameSeqStr = parts[1]

      if (streamId.length != 22) return null
      for (c in streamId) {
        val ok = (c in 'A'..'Z') || (c in 'a'..'z') || (c in '0'..'9') || c == '_' || c == '-'
        if (!ok) return null
      }

      if (frameSeqStr.isEmpty() || frameSeqStr.length > 10) return null
      if (frameSeqStr.length > 1 && frameSeqStr[0] == '0') return null
      for (c in frameSeqStr) {
        if (c !in '0'..'9') return null
      }
      val frameSeq = frameSeqStr.toIntOrNull() ?: return null
      if (frameSeq < 0) return null

      return Pair(streamId, frameSeq)
    }
  }
}

/** Thread-safe sessionId -> frame store registry for synchronous module-level JSI staging. */
internal object MobileWebShellScreencastSessionRegistry {
  private val lock = ReentrantLock()
  private val stores = HashMap<String, MobileWebShellScreencastFrameStore>()

  fun register(sessionId: String, store: MobileWebShellScreencastFrameStore) {
    lock.withLock { stores[sessionId] = store }
  }

  fun unregister(sessionId: String, store: MobileWebShellScreencastFrameStore) {
    lock.withLock {
      if (stores[sessionId] === store) {
        stores.remove(sessionId)
      }
    }
  }

  fun stage(
    sessionId: String,
    streamId: String,
    frameSeq: Int,
    mimeType: String,
    bytes: ByteArray
  ): String? {
    val store = lock.withLock { stores[sessionId] } ?: return null
    return store.stage(streamId, frameSeq, mimeType, bytes)
  }

  fun clear(sessionId: String, streamId: String?) {
    val store = lock.withLock { stores[sessionId] } ?: return
    if (streamId != null) {
      store.clearStream(streamId)
    } else {
      store.clearAll()
    }
  }
}
