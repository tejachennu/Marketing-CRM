// Writes every line the videos say (each scene, in English, Telugu and Hindi) with its clip name, for
// mobile/design/voice/make_voice.py. Not part of the test run (no _test in the name).
//   VOICE_LINES=design/voice/lines.json flutter test test/voice_lines.dart
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/screens/explainers/explainer_content.dart';
import 'package:wama_mobile/screens/explainers/narrator.dart';

void main() {
  test('write the voice lines', () {
    final lines = <Map<String, Object>>[];
    for (final ex in explainers) {
      for (final (i, scene) in ex.scenes.indexed) {
        for (final (lang, _) in videoLanguages) {
          final text = spokenWords(scene, lang);
          lines.add({'video': ex.id, 'scene': i, 'lang': lang, 'text': text, 'name': voiceClipName(text, lang)});
        }
      }
    }
    final out = File(Platform.environment['VOICE_LINES'] ?? 'design/voice/lines.json')..createSync(recursive: true);
    out.writeAsStringSync(const JsonEncoder.withIndent('  ').convert(lines));
    // ignore: avoid_print
    print('${lines.length} lines → ${out.path}');
  });
}
