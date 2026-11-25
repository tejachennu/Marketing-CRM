import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'release_helpers.dart';

/// A signed-out owner: the welcome page, "Already have an account? Sign in", the empty fields pointed out, then in.
void main() {
  final r = releaseApp();

  testWidgets('signed out: sign in from the welcome page (360 × 640)', (tester) async {
    await r.backend.signOut();
    expect(r.app.signedIn, isFalse);
    await useApp(tester, r.app, width: 360, height: 640, () async {
      final signInLink = find.textContaining('Already have an account?', findRichText: true);
      expect(signInLink, findsOneWidget);
      await tester.ensureVisible(signInLink);
      await settle(tester);
      await tester.tap(signInLink);
      await settle(tester);
      expect(find.text('Welcome back'), findsOneWidget);

      await tapText(tester, 'Sign in');
      expect(find.text('Enter your email.'), findsOneWidget);
      expect(find.text('Enter your password.'), findsOneWidget);

      await tester.enterText(find.widgetWithText(TextField, 'Email'), 'owner@srilakshmi.in');
      await tester.enterText(find.widgetWithText(TextField, 'Password'), 'secret12');
      await settle(tester);
      await tapText(tester, 'Sign in');
      for (var i = 0; i < 10 && find.text('Welcome back').evaluate().isNotEmpty; i++) {
        await settle(tester);
      }
      expect(r.app.signedIn, isTrue);
      expect(find.text('Welcome back'), findsNothing);
    });
  });
}
