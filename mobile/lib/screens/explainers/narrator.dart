import 'dart:convert' show jsonDecode, utf8;
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/services.dart' show AssetManifest, rootBundle;
import 'package:flutter_tts/flutter_tts.dart';
import 'package:just_audio/just_audio.dart';

import 'explainer_content.dart';
import 'explainer_narration.dart';

/// The voice of the explainer videos (owner, 25 Nov 2026: "for the videos audio is not coming", then "natural Indian
/// accent"): each scene's title and line is a recorded clip in English, Telugu or Hindi, made once by
/// mobile/design/voice/make_voice.py and shipped in assets/voice/ (works offline, starts at once). A line with no clip
/// (changed words not recorded again) is read by the phone's own text-to-speech; a phone without that language says so.
abstract class Narrator {
  /// Loads what it needs before the first scene (the clips' lengths).
  Future<void> warmUp();

  /// How long [text] takes to say in [lang], when known (a recorded clip): the scene then lasts as long as its words.
  int? lengthMs(String text, String lang);

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

  @override
  Future<void> warmUp() async {}

  @override
  int? lengthMs(String text, String lang) => null;

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

/// The recorded clip for [text] in [lang]: `assets/voice/<lang>_<8 hex>.m4a`, the hex being FNV-1a (32-bit) of
/// "lang|text" in UTF-8. Changed words get a new name, so an old clip is never played for new words.
/// make_voice.py computes the same name.
String voiceClipName(String text, String lang) {
  var h = 0x811c9dc5;
  for (final b in utf8.encode('$lang|$text')) {
    h ^= b;
    h = (h * 0x01000193) & 0xFFFFFFFF;
  }
  return '${lang}_${h.toRadixString(16).padLeft(8, '0')}';
}

String voiceClipAsset(String text, String lang) => 'assets/voice/${voiceClipName(text, lang)}.m4a';

/// Plays the recorded clips; [fallback] reads lines that have none.
class RecordedNarrator implements Narrator {
  RecordedNarrator(this.fallback);
  final Narrator fallback;
  AudioPlayer? _player;
  Set<String>? _clips;
  Map<String, int> _lengths = const {};
  // Which one is speaking now, so stop() stops the right one
  bool _onClip = false;

  Future<Set<String>> _available() async {
    if (_clips != null) return _clips!;
    try {
      final manifest = await AssetManifest.loadFromAssetBundle(rootBundle);
      final clips = manifest.listAssets().where((a) => a.startsWith('assets/voice/') && a.endsWith('.m4a')).toSet();
      try {
        // Milliseconds per clip, written by make_voice.py
        final lengths = jsonDecode(await rootBundle.loadString('assets/voice/durations.json')) as Map;
        _lengths = {for (final MapEntry(:key, :value) in lengths.entries) '$key': (value as num).toInt()};
      } catch (_) {}
      return _clips = clips;
    } catch (_) {
      return _clips = <String>{};
    }
  }

  @override
  Future<void> warmUp() => _available();

  @override
  int? lengthMs(String text, String lang) {
    final clip = voiceClipAsset(text, lang);
    return _clips != null && _clips!.contains(clip) ? _lengths[voiceClipName(text, lang)] : null;
  }

  @override
  Future<bool> canSpeak(String lang) async {
    if ((await _available()).any((a) => a.startsWith('assets/voice/${lang}_'))) return true;
    return fallback.canSpeak(lang);
  }

  @override
  Future<bool> say(String text, String lang) async {
    final clip = voiceClipAsset(text, lang);
    if (!(await _available()).contains(clip)) {
      _onClip = false;
      return fallback.say(text, lang);
    }
    try {
      final player = _player ??= AudioPlayer();
      _onClip = true;
      await player.setAsset(clip);
      // play() returns when the clip ends, or when it is paused or stopped
      await player.play();
      return player.processingState == ProcessingState.completed;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<void> stop() async {
    try {
      if (_onClip) await _player?.stop();
    } catch (_) {}
    await fallback.stop();
  }
}

/// No speech (tests, desktop): every scene's words count as read at once.
class SilentNarrator implements Narrator {
  @override
  Future<void> warmUp() async {}
  @override
  int? lengthMs(String text, String lang) => null;
  @override
  Future<bool> canSpeak(String lang) async => true;
  @override
  Future<bool> say(String text, String lang) async => true;
  @override
  Future<void> stop() async {}
}

/// The narrator the player uses; tests put in their own.
Narrator narrator = !kIsWeb && (Platform.isAndroid || Platform.isIOS) ? RecordedNarrator(PhoneNarrator()) : SilentNarrator();

// Each scene's spoken words (explainer_narration.dart), found by the scene itself
final Map<Scene, Tx> _script = () {
  final map = Map<Scene, Tx>.identity();
  for (final ex in explainers) {
    final words = narration[ex.id] ?? const <Tx>[];
    for (final (i, scene) in ex.scenes.indexed) {
      if (i < words.length) map[scene] = words[i];
    }
  }
  return map;
}();

/// What is said for a scene: its spoken script (explainer_narration.dart), else its title and line. Written the way it
/// is spoken (advice asked of ChatGPT for a natural Indian voice): "24 × 7" → "24 by 7" in every language, short
/// capital words spelt out ("AI" → "A I", "GST" → "G S T"), English words kept in English letters.
String spokenWords(Scene scene, String lang) {
  String clean(String text) => text
      .replaceAll(RegExp(r'\s*×\s*'), ' by ')
      .replaceAll('→', ',')
      .replaceAllMapped(RegExp(r'\b([A-Z]{2,4})\b'), (m) => m[1]!.split('').join(' '))
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  final said = _script[scene];
  if (said != null) return clean(said.of(lang));
  final title = clean(scene.title.of(lang));
  final line = clean(scene.line.of(lang));
  final stop = RegExp(r'[.!?।]$').hasMatch(title) ? '' : '.';
  return '$title$stop $line';
}
