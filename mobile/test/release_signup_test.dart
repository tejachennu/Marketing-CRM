import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/screens/auth/auth_parts.dart';

import 'release_helpers.dart';

/// A new owner on a small phone: the welcome page, "Create a free account", the three sign-up steps (a wrong code
/// first, then the right one), and the welcome slides after it. The demo server's code is 123456.
void main() {
  final r = releaseApp();

  testWidgets('sign up from the welcome page, with a wrong code first (320 × 640)', (tester) async {
    await r.backend.signOut();
    await useApp(tester, r.app, width: 320, height: 640, () async {
      expect(find.text('Your business on WhatsApp, in one app'), findsOneWidget);
      await tapText(tester, 'Create a free account');

      // Step 1: the business. Next checks the fields first.
      expect(find.text('Start your free trial'), findsOneWidget);
      await tapText(tester, 'Next');
      expect(find.text('Enter your business name.'), findsOneWidget, reason: 'empty fields are pointed out');
      await tester.enterText(find.widgetWithText(TextField, 'Business name'), 'Sri Lakshmi Fashions');
      await tester.enterText(find.widgetWithText(TextField, 'Your name'), 'Teja');
      await tester.enterText(find.widgetWithText(TextField, 'Mobile number'), '9876543210');
      await settle(tester);
      await tapText(tester, 'Next');

      // Step 2: the login
      expect(find.text('Create your login'), findsOneWidget);
      await tester.enterText(find.widgetWithText(TextField, 'Email'), 'owner@srilakshmi.in');
      await tester.enterText(find.widgetWithText(TextField, 'Password'), 'secret12');
      await settle(tester);
      await tapText(tester, 'Create my free account');

      // Step 3: the code. A wrong one shows the server's words and the boxes in red.
      expect(find.text('Enter the code'), findsOneWidget);
      final codeField = find.descendant(of: find.byType(CodeBoxes), matching: find.byType(TextField));
      await tester.enterText(codeField, '000000');
      await settle(tester);
      expect(find.textContaining('That code is not right'), findsOneWidget);
      expect(r.app.signedIn, isFalse);

      await tester.enterText(codeField, '123456');
      // Making the account, signing in and the first sync take a moment
      for (var i = 0; i < 10 && find.text('Enter the code').evaluate().isNotEmpty; i++) {
        await settle(tester);
      }
      expect(r.app.signedIn, isTrue, reason: 'the right code makes the account and signs in');
      expect(r.app.needsOnboarding, isTrue);
      expect(find.text('Welcome! Your free trial has started'), findsOneWidget, reason: 'the welcome pages (videos first) follow sign-up');
    });
  });
}
