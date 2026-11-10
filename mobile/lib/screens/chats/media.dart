import 'dart:convert';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:share_plus/share_plus.dart';

import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// A file in a chat message: a photo, PDF, voice note, video or other file. Files customers send
/// on WhatsApp are kept inside the message ("data:" links); files we send are web links.
class ChatMedia {
  ChatMedia(this.source);
  final String source;

  bool get isData => source.startsWith('data:');

  /// The file type, like image/jpeg or application/pdf.
  String get mime {
    if (isData) {
      final end = source.indexOf(RegExp('[;,]'));
      return end > 5 ? source.substring(5, end).toLowerCase() : 'application/octet-stream';
    }
    final path = (Uri.tryParse(source)?.path ?? '').toLowerCase();
    final ext = path.contains('.') ? path.substring(path.lastIndexOf('.') + 1) : '';
    return switch (ext) {
      'jpg' || 'jpeg' => 'image/jpeg',
      'png' => 'image/png',
      'webp' => 'image/webp',
      'gif' => 'image/gif',
      'pdf' => 'application/pdf',
      'mp4' => 'video/mp4',
      'ogg' || 'opus' => 'audio/ogg',
      'mp3' => 'audio/mpeg',
      'm4a' || 'aac' => 'audio/aac',
      'amr' => 'audio/amr',
      'doc' => 'application/msword',
      'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls' => 'application/vnd.ms-excel',
      'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      _ => 'application/octet-stream',
    };
  }

  bool get isImage => mime.startsWith('image/');

  /// What to call it in the chat.
  String get label {
    if (isImage) return 'Photo';
    if (mime == 'application/pdf') return 'PDF';
    if (mime.startsWith('audio/')) return 'Voice note';
    if (mime.startsWith('video/')) return 'Video';
    if (mime.contains('sheet') || mime.contains('excel')) return 'Spreadsheet';
    if (mime.contains('word')) return 'Word file';
    if (!isData) {
      final name = Uri.tryParse(source)?.pathSegments.lastOrNull ?? '';
      if (name.isNotEmpty) return Uri.decodeComponent(name);
    }
    return 'File';
  }

  IconData get icon {
    if (isImage) return Icons.image_outlined;
    if (mime == 'application/pdf') return Icons.picture_as_pdf_outlined;
    if (mime.startsWith('audio/')) return Icons.mic_none;
    if (mime.startsWith('video/')) return Icons.videocam_outlined;
    if (mime.contains('sheet') || mime.contains('excel')) return Icons.table_chart_outlined;
    return Icons.insert_drive_file_outlined;
  }

  /// A file name to save it under, like "photo-20261110-1930.jpg".
  String fileName(DateTime? at) {
    final t = at ?? DateTime.now();
    String two(int n) => n.toString().padLeft(2, '0');
    final stamp = '${t.year}${two(t.month)}${two(t.day)}-${two(t.hour)}${two(t.minute)}';
    final ext = switch (mime) {
      'image/jpeg' => 'jpg',
      'image/png' => 'png',
      'image/webp' => 'webp',
      'image/gif' => 'gif',
      'application/pdf' => 'pdf',
      'video/mp4' => 'mp4',
      'audio/ogg' => 'ogg',
      'audio/mpeg' => 'mp3',
      'audio/aac' => 'aac',
      'audio/amr' => 'amr',
      _ => mime.contains('sheet') ? 'xlsx' : (mime.contains('word') ? 'docx' : 'bin'),
    };
    if (!isData && label.contains('.')) return label;
    return '${label.toLowerCase().replaceAll(' ', '-')}-$stamp.$ext';
  }

  Uint8List? _bytes;

  /// The file itself: read from the message, or downloaded from its link.
  Future<Uint8List> bytes() async {
    if (_bytes != null) return _bytes!;
    if (isData) {
      final comma = source.indexOf(',');
      if (comma < 0) throw Exception('This file could not be read.');
      final data = source.substring(comma + 1);
      return _bytes = source.substring(0, comma).contains(';base64') ? base64Decode(data) : Uint8List.fromList(utf8.encode(Uri.decodeComponent(data)));
    }
    final res = await http.get(Uri.parse(source));
    if (res.statusCode != 200) throw Exception('The file could not be downloaded (${res.statusCode}).');
    return _bytes = res.bodyBytes;
  }

  /// The photo shown in the chat (a data photo is drawn from the message itself).
  Widget image({double? height, BoxFit fit = BoxFit.cover, Widget? onError}) {
    final fallback = onError ?? const SizedBox.shrink();
    if (isData) {
      try {
        final comma = source.indexOf(',');
        return Image.memory(base64Decode(source.substring(comma + 1)), height: height, fit: fit, gaplessPlayback: true, errorBuilder: (_, _, _) => fallback);
      } catch (_) {
        return fallback;
      }
    }
    return Image.network(source, height: height, fit: fit, errorBuilder: (_, _, _) => fallback);
  }
}

/// Save the file on the phone (the phone asks where), with a note of how it went.
Future<void> saveMedia(BuildContext context, ChatMedia media, DateTime? at) async {
  try {
    final data = await media.bytes();
    final path = await FilePicker.saveFile(dialogTitle: 'Save ${media.label.toLowerCase()}', fileName: media.fileName(at), bytes: data);
    if (context.mounted && path != null) toast(context, 'Saved.');
  } catch (e) {
    if (context.mounted) toast(context, '$e'.replaceFirst('Exception: ', ''));
  }
}

/// Open it with another app (PDF viewer, Gallery, Drive, WhatsApp…) through the phone's share sheet.
Future<void> openMedia(BuildContext context, ChatMedia media, DateTime? at) async {
  try {
    final data = await media.bytes();
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile.fromData(data, mimeType: media.mime, name: media.fileName(at))],
        fileNameOverrides: [media.fileName(at)],
      ),
    );
  } catch (e) {
    if (context.mounted) toast(context, '$e'.replaceFirst('Exception: ', ''));
  }
}

/// Tap a file in a chat: a photo opens full screen; anything else offers Open and Save.
Future<void> showMedia(BuildContext context, ChatMedia media, DateTime? at) async {
  if (media.isImage) {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => PhotoScreen(media: media, at: at),
      ),
    );
    return;
  }
  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheet) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(media.icon, color: Brand.blue, size: 28),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    media.label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: () {
                Navigator.pop(sheet);
                openMedia(context, media, at);
              },
              icon: const Icon(Icons.open_in_new),
              label: const Text('Open with an app'),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () {
                Navigator.pop(sheet);
                saveMedia(context, media, at);
              },
              icon: const Icon(Icons.download),
              label: const Text('Save to phone'),
            ),
          ],
        ),
      ),
    ),
  );
}

/// A photo full screen: pinch to zoom, Save and Share.
class PhotoScreen extends StatelessWidget {
  const PhotoScreen({super.key, required this.media, this.at});
  final ChatMedia media;
  final DateTime? at;
  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Colors.black,
    appBar: AppBar(
      backgroundColor: Colors.black,
      foregroundColor: Colors.white,
      title: const Text('Photo'),
      actions: [
        IconButton(tooltip: 'Share', onPressed: () => openMedia(context, media, at), icon: const Icon(Icons.share_outlined)),
        IconButton(tooltip: 'Save to phone', onPressed: () => saveMedia(context, media, at), icon: const Icon(Icons.download)),
      ],
    ),
    body: Center(
      child: InteractiveViewer(
        maxScale: 5,
        child: media.image(
          fit: BoxFit.contain,
          onError: const Icon(Icons.broken_image_outlined, color: Colors.white54, size: 48),
        ),
      ),
    ),
  );
}
