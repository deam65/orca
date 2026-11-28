import Foundation

/// Bounded in-memory store for zero-copy screencast frames served at /__orca_screencast/<streamId>/<frameSeq>.
/// Thread-safe (NSLock) and bounded by max frames per stream, max streams, max frame bytes, and total bytes.
public struct MobileWebShellScreencastFrameEntry {
  public let streamId: String
  public let frameSeq: Int
  public let mimeType: String
  public let data: Data
}

public class MobileWebShellScreencastFrameStore {
  private let lock = NSLock()
  private let maxFramesPerStream: Int
  private let maxStreams: Int
  private let maxFrameBytes: Int
  private let maxTotalBytes: Int

  private var streams: [String: [MobileWebShellScreencastFrameEntry]] = [:]
  private var streamOrder: [String] = []
  private var totalBytes: Int = 0

  public init(
    maxFramesPerStream: Int = 12,
    maxStreams: Int = 8,
    maxFrameBytes: Int = 8 * 1024 * 1024,
    maxTotalBytes: Int = 16 * 1024 * 1024
  ) {
    self.maxFramesPerStream = maxFramesPerStream
    self.maxStreams = maxStreams
    self.maxFrameBytes = maxFrameBytes
    self.maxTotalBytes = maxTotalBytes
  }

  /// Parses and validates a screencast path: /__orca_screencast/<streamId>/<frameSeq>
  public static func parsePath(_ path: String) -> (streamId: String, frameSeq: Int)? {
    let prefix = "/__orca_screencast/"
    guard path.hasPrefix(prefix) else { return nil }
    let remainder = path.dropFirst(prefix.count)
    guard let slash = remainder.firstIndex(of: "/") else { return nil }
    let streamSub = remainder[..<slash]
    let seqSub = remainder[remainder.index(after: slash)...]
    guard !seqSub.contains("/") else { return nil }

    // Validate streamId: ^[A-Za-z0-9_-]{22}$ without per-call CharacterSet allocations.
    guard streamSub.utf8.count == 22 else { return nil }
    for b in streamSub.utf8 {
      let ok = (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || (b >= 48 && b <= 57) || b == 95 || b == 45
      if !ok { return nil }
    }

    // Validate frameSeq: non-negative base-10 integer string of 1..10 ASCII digits, no leading zero.
    let seqCount = seqSub.utf8.count
    guard seqCount >= 1, seqCount <= 10 else { return nil }
    if seqCount > 1 && seqSub.utf8.first == 48 { return nil }
    for b in seqSub.utf8 {
      if b < 48 || b > 57 { return nil }
    }
    guard let frameSeq = Int(seqSub), frameSeq >= 0, frameSeq <= Int(Int32.max) else { return nil }

    return (String(streamSub), frameSeq)
  }

  public func stage(streamId: String, frameSeq: Int, mimeType: String, data: Data) -> String? {
    guard mimeType == "image/jpeg" || mimeType == "image/png" else { return nil }
    guard data.count > 0 && data.count <= maxFrameBytes else { return nil }

    let path = "/__orca_screencast/\(streamId)/\(frameSeq)"
    guard MobileWebShellScreencastFrameStore.parsePath(path) != nil else { return nil }

    lock.lock()
    defer { lock.unlock() }

    let entry = MobileWebShellScreencastFrameEntry(
      streamId: streamId,
      frameSeq: frameSeq,
      mimeType: mimeType,
      data: data
    )

    var frames = streams[streamId] ?? []
    if let idx = frames.firstIndex(where: { $0.frameSeq == frameSeq }) {
      totalBytes -= frames[idx].data.count
      frames[idx] = entry
    } else {
      frames.append(entry)
      while frames.count > maxFramesPerStream {
        let removed = frames.removeFirst()
        totalBytes -= removed.data.count
      }
    }

    if let orderIdx = streamOrder.firstIndex(of: streamId) {
      streamOrder.remove(at: orderIdx)
    }
    streamOrder.append(streamId)

    while streamOrder.count > maxStreams {
      let oldestStream = streamOrder.removeFirst()
      if let removedFrames = streams.removeValue(forKey: oldestStream) {
        for rf in removedFrames {
          totalBytes -= rf.data.count
        }
      }
    }

    totalBytes += data.count
    streams[streamId] = frames

    while totalBytes > maxTotalBytes && !streamOrder.isEmpty {
      let oldestStream = streamOrder[0]
      if var streamFrames = streams[oldestStream], !streamFrames.isEmpty {
        let removed = streamFrames.removeFirst()
        totalBytes -= removed.data.count
        if streamFrames.isEmpty {
          streams.removeValue(forKey: oldestStream)
          streamOrder.removeFirst()
        } else {
          streams[oldestStream] = streamFrames
        }
      } else {
        streamOrder.removeFirst()
      }
    }

    return path
  }

  public func read(path: String) -> (mimeType: String, data: Data)? {
    guard let parsed = MobileWebShellScreencastFrameStore.parsePath(path) else { return nil }
    lock.lock()
    defer { lock.unlock() }
    guard let frames = streams[parsed.streamId] else { return nil }
    guard let entry = frames.first(where: { $0.frameSeq == parsed.frameSeq }) else { return nil }
    return (entry.mimeType, entry.data)
  }

  public func clearStream(streamId: String) {
    lock.lock()
    defer { lock.unlock() }
    if let frames = streams.removeValue(forKey: streamId) {
      for f in frames {
        totalBytes -= f.data.count
      }
    }
    if let idx = streamOrder.firstIndex(of: streamId) {
      streamOrder.remove(at: idx)
    }
  }

  public func clearAll() {
    lock.lock()
    defer { lock.unlock() }
    streams.removeAll()
    streamOrder.removeAll()
    totalBytes = 0
  }
}

/// Thread-safe registry mapping active web-shell sessionId -> frame store for synchronous module-level JSI staging.
public final class MobileWebShellScreencastSessionRegistry {
  public static let shared = MobileWebShellScreencastSessionRegistry()

  private let lock = NSLock()
  private var stores: [String: MobileWebShellScreencastFrameStore] = [:]

  public init() {}

  public func register(sessionId: String, store: MobileWebShellScreencastFrameStore) {
    lock.lock()
    defer { lock.unlock() }
    stores[sessionId] = store
  }

  public func unregister(sessionId: String, store: MobileWebShellScreencastFrameStore) {
    lock.lock()
    defer { lock.unlock() }
    if stores[sessionId] === store {
      stores.removeValue(forKey: sessionId)
    }
  }

  public func stage(
    sessionId: String,
    streamId: String,
    frameSeq: Int,
    mimeType: String,
    data: Data
  ) -> String? {
    lock.lock()
    let store = stores[sessionId]
    lock.unlock()
    return store?.stage(streamId: streamId, frameSeq: frameSeq, mimeType: mimeType, data: data)
  }

  public func clear(sessionId: String, streamId: String?) {
    lock.lock()
    let store = stores[sessionId]
    lock.unlock()
    if let streamId {
      store?.clearStream(streamId: streamId)
    } else {
      store?.clearAll()
    }
  }
}
