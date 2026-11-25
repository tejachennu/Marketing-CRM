import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/screens/explainers/explainer_player.dart';
import 'package:wama_mobile/ui/theme.dart';
import 'package:wama_mobile/screens/explainers/explainer_content.dart';
import 'package:wama_mobile/screens/explainers/explainer_narration.dart';
import 'package:wama_mobile/screens/explainers/narrator.dart';

import 'release_helpers.dart';

/// A pretend voice: remembers what it was asked to say, and finishes when the test says so.
class FakeNarrator implements Narrator {
  final said = <String>[];
  final langs = <String>[];
  Set<String> voices = {'en', 'te', 'hi'};
  int stops = 0;
  Completer<bool>? _reading;

  @override
  Future<void> warmUp() async {}

  @override
  int? lengthMs(String text, String lang) => null;

  @override
  Future<bool> canSpeak(String lang) async => voices.contains(lang);

  @override
  Future<bool> say(String text, String lang) {
    said.add(text);
    langs.add(lang);
    return (_reading = Completer<bool>()).future;
  }

  @override
  Future<void> stop() async {
    stops++;
    final r = _reading;
    _reading = null;
    if (r != null && !r.isCompleted) r.complete(false);
  }

  /// The words of the current scene have been read to the end
  void finish() {
    final r = _reading;
    _reading = null;
    if (r != null && !r.isCompleted) r.complete(true);
  }
}

void main() {
  final r = releaseApp();
  final grow = explainers.first;
  late FakeNarrator fake;
  late Narrator before;

  setUp(() {
    before = narrator;
    narrator = fake = FakeNarrator();
  });
  tearDown(() => narrator = before);

  /// Lets the player run and the phone store finish saving (saves run outside the test's clock)
  Future<void> settleSaves(WidgetTester tester) async {
    for (var i = 0; i < 10; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
      await tester.pump();
    }
  }

  Future<void> open(WidgetTester tester) async {
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.runAsync(() => r.app.store.write('videos', {'lang': 'en', 'watched': <String>[], 'sound': true}));
    // The real player (the 'video' preview holds still for screenshots)
    await tester.pumpWidget(AppScope(state: r.app, child: MaterialApp(theme: buildTheme(), home: const ExplainerScreen(startId: 'grow'))));
    await settleSaves(tester);
  }

  Future<void> close(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
  }

  testWidgets('each scene is read aloud, and the next one waits for the words', (tester) async {
    await open(tester);
    expect(fake.said.last, spokenWords(grow.scenes[0], 'en'));
    expect(fake.said.last, contains('24 by 7'), reason: '"24 × 7" is said the way people say it');

    // The picture has played but the words are still being read: the scene stays
    await tester.pump(Duration(milliseconds: grow.scenes[0].ms + 300));
    expect(find.text(grow.scenes[0].title.en), findsOneWidget);

    fake.finish();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text(grow.scenes[1].title.en), findsOneWidget, reason: 'then the next scene starts');
    expect(fake.said.last, spokenWords(grow.scenes[1], 'en'));

    // Words read quickly: the scene still plays its picture to the end before moving on
    fake.finish();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text(grow.scenes[1].title.en), findsOneWidget);
    await close(tester);
  });

  // Everything that saves a setting (language, sound) is in this one test: a save started in one widget test can hold
  // up the phone store in the next (see release_helpers.dart)
  testWidgets('pause, language, sound off and on, and a phone without a voice', (tester) async {
    await open(tester);

    // Pause stops the voice; play reads the scene again from the start
    final stopsBefore = fake.stops;
    await tester.tap(find.byTooltip(VideoWords.pause.en));
    await tester.pump();
    expect(fake.stops, greaterThan(stopsBefore));
    final saidBefore = fake.said.length;
    await tester.tap(find.byTooltip(VideoWords.play.en));
    await settleSaves(tester);
    expect(fake.said.length, saidBefore + 1, reason: 'the scene is read again from the start');

    // Telugu is read in Telugu
    await tester.tap(find.text('తెలుగు'));
    await settleSaves(tester);
    expect(fake.langs.last, 'te');
    expect(fake.said.last, spokenWords(grow.scenes[0], 'te'));

    // A phone without a Hindi voice says how to add one
    fake.voices = {'en', 'te'};
    final saidBeforeHindi = fake.said.length;
    await tester.tap(find.text('हिंदी'));
    await settleSaves(tester);
    expect(find.text(VideoWords.noVoice.hi), findsOneWidget);
    expect(fake.said.length, saidBeforeHindi, reason: 'nothing is read without a voice');

    // Back to English; sound off is saved and the scenes carry on without the voice
    await tester.tap(find.text('English'));
    await settleSaves(tester);
    expect(find.text(VideoWords.noVoice.en), findsNothing);
    await tester.tap(find.byTooltip(VideoWords.soundOff.en));
    await settleSaves(tester);
    expect(r.app.store.read('videos')?['sound'], false);
    final saidMuted = fake.said.length;
    await tester.pump(Duration(milliseconds: grow.scenes[0].ms + 300));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text(grow.scenes[1].title.en), findsOneWidget);
    expect(fake.said.length, saidMuted, reason: 'nothing is read with the sound off');

    // Sound on: this scene is read again
    await tester.tap(find.byTooltip(VideoWords.soundOn.en));
    await settleSaves(tester);
    expect(r.app.store.read('videos')?['sound'], true);
    expect(fake.said.last, spokenWords(grow.scenes[1], 'en'));
    await close(tester);
  });

  test('every line of every video has its recorded voice, in English, Telugu and Hindi', () {
    final missing = <String>[];
    for (final ex in explainers) {
      for (final (i, scene) in ex.scenes.indexed) {
        for (final (lang, _) in videoLanguages) {
          final clip = voiceClipAsset(spokenWords(scene, lang), lang);
          if (!File(clip).existsSync()) missing.add('${ex.id} scene $i ($lang): $clip');
        }
      }
    }
    expect(missing, isEmpty, reason: 'Words changed: make the voice again (design/voice/README.md)\n${missing.join('\n')}');
  });

  test('the app and the voice maker name the clips the same way', () {
    final lines = (jsonDecode(File('design/voice/lines.json').readAsStringSync()) as List).cast<Map>();
    for (final line in lines.take(12)) {
      expect(voiceClipName('${line['text']}', '${line['lang']}'), line['name']);
    }
  });

  testWidgets('a line with no recorded clip is read by the phone instead', (tester) async {
    final phone = FakeNarrator();
    final recorded = RecordedNarrator(phone);
    await tester.runAsync(() async {
      expect(await recorded.canSpeak('te'), isTrue, reason: 'Telugu clips are in the app');
      unawaited(recorded.say('A line nobody recorded', 'en'));
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    expect(phone.said, ['A line nobody recorded']);
    await tester.runAsync(recorded.stop);
    expect(phone.stops, 1);
  });

  test('the words said: the spoken script (Tenglish / Hinglish), "×" said "by", short capital words spelt out', () {
    final scene = grow.scenes[0];
    expect(spokenWords(scene, 'en'), startsWith('Your shop stays open on WhatsApp, 24 by 7.'));
    expect(spokenWords(scene, 'te'), contains('24 by 7'));
    expect(spokenWords(scene, 'te'), contains('Customer'), reason: 'everyday English words stay in English, as people speak');
    expect(spokenWords(scene, 'hi'), contains('24 by 7'));
    // Every scene of every video has its own spoken words, in each language
    for (final ex in explainers) {
      expect(narration[ex.id]?.length, ex.scenes.length, reason: ex.id);
    }
    final replies = explainers.firstWhere((e) => e.id == 'replies').scenes.last;
    expect(spokenWords(replies, 'en'), contains('A I assistant'));
    expect(spokenWords(replies, 'en'), isNot(contains(' AI ')));
  });
}
