import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/main.dart';
import 'package:wama_mobile/screens/explainers/explainer_content.dart';
import 'package:wama_mobile/screens/explainers/explainer_player.dart';

import 'release_helpers.dart';

/// Owner: "if the app opened outside of India don't show Hindi and Telugu". A workspace in US dollars.
void main() {
  final r = releaseApp();
  setUpAll(() async {
    final me = Map<String, dynamic>.from(r.app.me!);
    me['organization'] = {...Map<String, dynamic>.from(me['organization'] as Map), 'currency': 'USD'};
    await r.app.store.write('me', me);
  });

  testWidgets('outside India: no Telugu or Hindi, and no scene showing them', (tester) async {
    expect(indianLanguagesOn(r.app), isFalse);
    expect(videoLanguage(r.app), 'en');
    final replies = explainers.firstWhere((e) => e.id == 'replies');
    expect(scenesFor(replies, false).any((s) => s.kind == SceneKind.languages), isFalse);

    tester.view.physicalSize = const Size(360, 780);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(WamaApp(app: r.app, screen: 'videos'));
    await settle(tester);
    expect(find.text('తెలుగు'), findsNothing);
    expect(find.text('हिंदी'), findsNothing);
    expect(find.text('How we grow your business'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await settle(tester);
  });
}
