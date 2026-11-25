import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'release_helpers.dart';

/// Google Play's rule: an owner can ask for the account to be deleted from inside the app (More → Delete my account).
void main() {
  final r = releaseApp();

  testWidgets('owner asks to delete the account from More (320 × 640)', (tester) async {
    await useApp(tester, r.app, width: 320, height: 640, () async {
      await tester.tap(find.text('More').last);
      await settle(tester);
      await tapText(tester, 'Delete my account');
      expect(find.textContaining('whole workspace'), findsOneWidget, reason: 'an owner is told the whole workspace goes');

      // Nothing is sent until they tick that they understand
      final send = await reach(tester, find.widgetWithText(FilledButton, 'Send request'));
      expect(tester.widget<FilledButton>(send).onPressed, isNull);
      await tapText(tester, 'I understand my data will be deleted');
      expect(tester.widget<FilledButton>(send).onPressed, isNotNull);

      await tapText(tester, 'Send request');
      expect(find.text('Request sent'), findsOneWidget);
      expect(find.text('Sign out'), findsWidgets);
    });
  });
}
