import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/main.dart';
import 'package:wama_mobile/screens/explainers/explainer_content.dart';
import 'package:wama_mobile/screens/explainers/explainer_player.dart';
import 'package:wama_mobile/ui/theme.dart';

import 'release_helpers.dart';

/// The explainer videos: skip through the scenes, switch to Telugu, reach the end, play the next one; every scene of
/// every video in every language fits a small phone.
void main() {
  final r = releaseApp();

  testWidgets('play a video: next scene, Telugu voice (words stay English), the end, next video (320 × 640)', (tester) async {
    final problems = <String>[];
    final old = FlutterError.onError;
    FlutterError.onError = (d) => problems.add(d.exceptionAsString().split('\n').first);
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(WamaApp(app: r.app, screen: 'video'));
    await settle(tester);

    final grow = explainers.first;
    expect(find.text(grow.scenes[0].title.en), findsOneWidget);
    await tester.tap(find.byTooltip('Next'));
    await settle(tester);
    expect(find.text(grow.scenes[1].title.en), findsOneWidget, reason: 'Next moves to the second scene');

    await tester.tap(find.text('తెలుగు'));
    await settle(tester);
    expect(find.text(grow.scenes[1].title.en), findsOneWidget, reason: 'the words on screen stay in English: the buttons pick the voice');
    expect(find.text(grow.scenes[1].title.te), findsNothing);
    expect(r.app.store.read('videos')?['lang'], 'te');

    for (var i = 1; i < grow.scenes.length; i++) {
      await tester.tap(find.byTooltip(VideoWords.forward.en));
      await settle(tester);
    }
    expect(find.text(VideoWords.again.en), findsOneWidget, reason: 'the end shows Watch again');
    expect(watchedVideos(r.app), contains('grow'));

    await tester.tap(find.textContaining(VideoWords.next.en));
    await settle(tester);
    expect(find.text(explainers[1].scenes[0].title.en), findsOneWidget, reason: 'the next video starts');

    await tester.pumpWidget(const SizedBox());
    await settle(tester);
    FlutterError.onError = old;
    expect(problems, isEmpty, reason: problems.toSet().join('\n'));
  });

  testWidgets('every scene of every video fits, in each language (320 × 568, large text)', (tester) async {
    final problems = <String>[];
    final old = FlutterError.onError;
    FlutterError.onError = (d) => problems.add(d.exceptionAsString().split('\n').first);
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    addTearDown(tester.view.reset);
    for (final ex in explainers) {
      for (var i = 0; i < ex.scenes.length; i++) {
        for (final (lang, _) in videoLanguages) {
          await tester.pumpWidget(
            AppScope(
              state: r.app,
              child: MaterialApp(theme: buildTheme(), home: ExplainerScreen(startId: ex.id, startScene: i, holdAt: 0.9, lang: lang)),
            ),
          );
          await tester.pump();
          if (problems.isNotEmpty) problems.add('… in ${ex.id} scene $i ($lang)');
        }
      }
    }
    await tester.pumpWidget(const SizedBox());
    FlutterError.onError = old;
    expect(problems, isEmpty, reason: problems.toSet().join('\n'));
  });
}
