import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'release_helpers.dart';

/// A shop that only bills walk-ins (owner, 25 Nov 2026: "in some shops they don't need appointment booking, they can
/// hide it"): Front Desk → Setup → Appointments off. The Front Desk shows today's bills, with no Bookings / Requests
/// tabs and no Book button; Setup hides the booking flow; WhatsApp setup has no booking parts; the website settings
/// show Book now as not available; the owner can switch appointments back on (and off again, after a question).
/// Everything is one test: a save started in one test can hold up the phone store in the next.
void main() {
  final r = releaseApp(appointments: false);

  /// A save goes to the server and the setup is read again: wait until the screen shows it.
  Future<void> until(WidgetTester tester, Finder finder) async {
    for (var i = 0; i < 10 && finder.evaluate().isEmpty; i++) {
      await settle(tester);
    }
  }

  testWidgets('Walk-in shop: today\'s bills without bookings; Setup, WhatsApp and website follow the switch; it can go back on', (tester) async {
    await useApp(tester, r.app, () async {
      // Front Desk: today's walk-in bills
      expect(r.app.takesAppointments, isFalse);
      expect(find.text('Bookings'), findsNothing);
      expect(find.text('Requests'), findsNothing);
      expect(find.text('Book'), findsNothing);
      expect(find.byTooltip('Pick a day'), findsNothing);
      expect(find.text('Bills today'), findsOneWidget);
      expect(find.text('New bill'), findsWidgets);
      // A visit booked before appointments were switched off is kept, and can still be billed
      expect(find.textContaining('Booked earlier'), findsOneWidget);
      expect(find.textContaining('Bills · '), findsOneWidget);

      // Setup: the switch, no booking flow, only two templates needed
      await tester.tap(find.byTooltip('Setup'));
      await settle(tester);
      expect(find.text('We take appointments'), findsOneWidget);
      expect(find.text('Booking flow'), findsNothing);
      expect(find.text('Website'), findsOneWidget);
      expect(find.text('All 2 set up').evaluate().isNotEmpty || find.textContaining('of 2 set up').evaluate().isNotEmpty, isTrue, reason: 'only the bill and feedback templates are needed');

      // WhatsApp setup: no booking parts
      await tapText(tester, 'WhatsApp');
      expect(find.text('Accept bookings on their own'), findsNothing);
      expect(find.text('Reminders'), findsNothing);
      expect(find.text('Ask for feedback'), findsOneWidget);
      await tester.pageBack();
      await settle(tester);

      // Website: Book now cannot show, no booking payment
      await tapText(tester, 'Website');
      // The page's own list (its text fields scroll too, so not "the last list on the screen")
      final page = find.byType(ListView).first;
      final book = find.widgetWithText(SwitchListTile, 'Book now');
      await tester.dragUntilVisible(book, page, const Offset(0, -250));
      await settle(tester);
      expect(find.text('Buttons on your website'), findsWidgets);
      expect(book, findsOneWidget);
      final tile = tester.widget<SwitchListTile>(book);
      expect(tile.value, isFalse, reason: 'Book now cannot show without appointments');
      expect(tile.onChanged, isNull);
      expect(find.textContaining('Appointments are off'), findsOneWidget);
      // The booking payment card is not there at all
      await tester.drag(page, const Offset(0, -2000));
      await settle(tester);
      expect(find.text('Payment when booking'), findsNothing);
      await tester.pageBack();
      await settle(tester);

      // On: the booking flow comes back
      await tapText(tester, 'We take appointments');
      await until(tester, find.text('Booking flow'));
      expect(r.app.takesAppointments, isTrue);
      expect(find.text('Booking flow'), findsOneWidget);
      expect(find.text('Website and booking'), findsOneWidget);

      // Off again: asked first, with what it hides
      await tapText(tester, 'We take appointments');
      expect(find.text('Stop taking appointments?'), findsOneWidget);
      expect(find.textContaining('Appointment reminders'), findsOneWidget);
      await tapText(tester, 'Switch off');
      await until(tester, find.text('Website'));
      expect(r.app.takesAppointments, isFalse);
      expect(find.text('Booking flow'), findsNothing);

      // And on, back to the Front Desk with its Bookings tab and Book button
      await tapText(tester, 'We take appointments');
      await until(tester, find.text('Booking flow'));
      expect(r.app.takesAppointments, isTrue);
      await tester.pageBack();
      await settle(tester);
      expect(find.text('Bookings'), findsWidgets);
      expect(find.text('Book'), findsWidgets);
    });
  });
}
