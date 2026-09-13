package app.foundkeep.shared

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.sharing.SharingSingleton
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.WeakHashMap

/** Retain distinct intents until their exact receipt has been copied/discarded.
 * Expo's single mutable slot cannot acknowledge an older asynchronous batch. */
class FoundkeepAndroidSharesModule : Module() {
  private val pending = linkedMapOf<String, Intent>()
  private val observed = WeakHashMap<Intent, String>()
  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  // All receipt operations run on Android's main queue, as does OnNewIntent.
  private fun capture(intent: Intent?) {
    if (intent == null || intent.action !in listOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE) || observed.containsKey(intent)) return
    val id = UUID.randomUUID().toString()
    observed[intent] = id
    pending[id] = intent
  }

  override fun definition() = ModuleDefinition {
    Name("FoundkeepAndroidShares")
    Events("onIncomingShare")
    OnNewIntent { intent ->
      capture(intent)
      if (observed.containsKey(intent)) sendEvent("onIncomingShare", emptyMap<String, Any>())
    }
    AsyncFunction("pendingReceipts") {
      // Includes the cold-start intent copied by Expo's activity listener.
      capture(SharingSingleton.intent)
      pending.map { (id, intent) -> mapOf("id" to id, "shares" to runCatching { parse(intent) }.getOrDefault(emptyList())) }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("acknowledgeReceipt") { id: String ->
      val intent = pending.remove(id)
      // Comparing the original Intent identity and clearing happen on the same
      // main queue: even a new intent with identical text is a separate receipt.
      if (intent != null && SharingSingleton.intent === intent) SharingSingleton.intent = null
      intent != null
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("localDisplayName") { value: String ->
      val uri = Uri.parse(value)
      require(uri.scheme == "content") { "Only a local content URI can supply a display name." }
      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (column >= 0 && cursor.moveToFirst() && !cursor.isNull(column)) cursor.getString(column) else null
      }
    }
    AsyncFunction("copyContentUri") { sourceValue: String, destinationValue: String, limitValue: Double ->
      val source = Uri.parse(sourceValue)
      val destinationUri = Uri.parse(destinationValue)
      require(source.scheme == "content") { "Only a local content URI can be copied." }
      require(destinationUri.scheme == "file") { "The private destination must be a file URI." }
      require(limitValue.isFinite() && limitValue >= 1 && limitValue <= Long.MAX_VALUE.toDouble()) { "The file limit is invalid." }
      val root = appContext.persistentFilesDirectory.canonicalFile
      val destination = File(requireNotNull(destinationUri.path) { "The private destination is invalid." }).canonicalFile
      require(destination.path.startsWith(root.path + File.separator)) { "The private destination is outside app storage." }
      require(!destination.exists()) { "The private destination already exists." }
      val limit = limitValue.toLong()
      try {
        val input = context.contentResolver.openInputStream(source) ?: error("The shared file could not be opened.")
        var total = 0L
        input.use { stream ->
          FileOutputStream(destination, false).use { output ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
              val count = stream.read(buffer)
              if (count < 0) break
              val next = total + count
              require(next <= limit) { "This file exceeds the saving limit." }
              output.write(buffer, 0, count)
              total = next
            }
          }
        }
        require(total > 0) { "This file is empty." }
        total
      } catch (error: Throwable) {
        destination.delete()
        throw error
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun streams(intent: Intent): List<Uri> {
    val uris = if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
      else intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
    } else {
      val uri = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
      else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      uri?.let { arrayListOf(it) }
    }
    if (!uris.isNullOrEmpty()) return uris
    val clip = intent.clipData ?: return emptyList()
    return (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
  }

  private fun parse(intent: Intent): List<Map<String, String>> {
    val files = streams(intent)
    if (files.isNotEmpty()) return files.map { uri ->
      // Local type lookup only. Text files stay files, not URI strings to save as text.
      val mime = if (uri.scheme == "content") runCatching { context.contentResolver.getType(uri) }.getOrNull() ?: intent.type else intent.type
      val type = when {
        mime?.startsWith("image/") == true -> "image"
        mime?.startsWith("video/") == true -> "video"
        mime?.startsWith("audio/") == true -> "audio"
        else -> "file"
      }
      mapOf("value" to uri.toString(), "shareType" to type, "mimeType" to (mime ?: "application/octet-stream"))
    }
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: return emptyList()
    // URL validation stays in the existing data-only TS policy parser.
    return listOf(mapOf("value" to text, "shareType" to "text", "mimeType" to "text/plain"))
  }
}
