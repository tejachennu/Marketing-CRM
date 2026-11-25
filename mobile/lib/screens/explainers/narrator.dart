import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_tts/flutter_tts.dart';

import 'explainer_content.dart';

/// The voice of the explainer videos (owner, 25 Nov 2026: "for the videos audio is not coming"): the phone's own
/// text-to-speech reads each scene's title and line in English, Telugu or Hindi. No sound files: the app stays small,
/// works offline, and the voice follows the language picked. A phone without a voice for that language says so.
abstract class Narrator {
  /// Whether this phone can speak [lang] ('en' | 'te' | 'hi').
  Future<bool> canSpeak(String lang);

  /// Reads [text] in [lang]; true when it was read to the end, false when stopped or it could not be read.
  Future<bool> say(String text, String lang);

  Future<void> stop();
}

/// Android's (and iOS's) speech engine through flutter_tts.
class PhoneNarrator implements Narrator {
  FlutterTts? _tts;
  final Map<String, String?> _locale = {};

  FlutterTts get _engine => _tts ??= FlutterTts();

  // India's English first (it says ₹ and Indian names better), else any English
  static const _choices = {
    'en': ['en-IN', 'en-US', 'en-GB'],
    'te': ['te-IN'],
    'hi': ['hi-IN'],
  };

  Future<String?> _localeFor(String lang) async {
    if (_locale.containsKey(lang)) return _locale[lang];
    String? found;
    for (final locale in _choices[lang] ?? const ['en-US']) {
      try {
        if (await _engine.isLanguageAvailable(locale) == true) {
          found = locale;
          break;
        }
      } catch (_) {
        break;
      }
    }
    return _locale[lang] = found;
  }

  @override
  Future<bool> canSpeak(String lang) async => await _localeFor(lang) != null;

  @override
  Future<bool> say(String text, String lang) async {
    try {
      final locale = await _localeFor(lang);
      if (locale == null) return false;
      final tts = _engine;
      await tts.awaitSpeakCompletion(true);
      await tts.setLanguage(locale);
      // 0.5 is the phone's normal pace; a little slower reads clearly for everyone
      await tts.setSpeechRate(0.45);
      await tts.setPitch(1.0);
      return await tts.speak(text) == 1;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<void> stop() async {
    try {
      await _tts?.stop();
    } catch (_) {}
  }
}

/// No speech (tests, desktop): every scene's words count as read at once.
class SilentNarrator implements Narrator {
  @override
  Future<bool> canSpeak(String lang) async => true;
  @override
  Future<bool> say(String text, String lang) async => true;
  @override
  Future<void> stop() async {}
}

/// The narrator the player uses; tests put in their own.
Narrator narrator = !kIsWeb && (Platform.isAndroid || Platform.isIOS) ? PhoneNarrator() : SilentNarrator();

/// What is said for a scene: its title, then its line, written the way it is spoken ("24 × 7" → "24 by 7").
String spokenWords(Scene scene, String lang) {
  final by = switch (lang) {
    'te' => ' బై ',
    'hi' => ' बाय ',
    _ => ' by ',
  };
  String clean(String text) => text.replaceAll(RegExp(r'\s*×\s*'), by).replaceAll('→', ',').replaceAll(RegExp(r'\s+'), ' ').trim();
  final title = clean(scene.title.of(lang));
  final line = clean(scene.line.of(lang));
  final stop = RegExp(r'[.!?।]$').hasMatch(title) ? '' : '.';
  return '$title$stop $line';
}
