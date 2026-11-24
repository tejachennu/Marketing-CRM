import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'release_helpers.dart';

/// The 14-day free trial has ended (owner): only "Choose a plan" until it is paid.
void main() {
  final r = releaseApp(billing: 'ended');

  testWidgets('the plan screen replaces the tabs; Choose a plan opens Billing (small phone)', (tester) async {
    await useApp(tester, r.app, width: 320, height: 640, () async {
      expect(r.app.paused, isTrue);
      expect(find.text('Your 14-day free trial has ended'), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing, reason: 'the tabs stay closed until a plan is chosen');
      await tapText(tester, 'Choose a plan');
      expect(find.text('Billing'), findsWidgets);
    });
  });

  testWidgets('large phone text still fits', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await useApp(tester, r.app, width: 360, height: 700, () async {
      expect(await reach(tester, find.text('I have paid, check again')), findsOneWidget);
    });
  });
}
