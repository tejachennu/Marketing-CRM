import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/data/demo_backend.dart';
import 'package:wama_mobile/data/format.dart';
import 'package:wama_mobile/data/local_store.dart';
import 'package:wama_mobile/data/notifier.dart';
import 'package:wama_mobile/screens/ai/knowledge_screen.dart';
import 'package:wama_mobile/screens/front_desk/booking_steps.dart';
import 'package:wama_mobile/screens/front_desk/logic.dart';
import 'package:wama_mobile/screens/templates/template_widgets.dart';
import 'package:wama_mobile/ui/validate.dart';
import 'package:wama_mobile/ui/widgets.dart';

Future<(AppState, DemoBackend)> makeApp() async {
  final dir = await Directory.systemTemp.createTemp('wama_test');
  final store = LocalStore();
  await store.open(path: dir.path);
  await store.clear();
  final backend = DemoBackend();
  final app = AppState(backend: backend, store: store);
  await app.refreshAll();
  return (app, backend);
}

void main() {
  test('Phone numbers: country code split and joined', () {
    final (india, local) = splitPhone('+919876543210');
    expect(india.code, '+91');
    expect(local, '9876543210');
    final (uae, rest) = splitPhone('+971501234567');
    expect(uae.code, '+971');
    expect(rest, '501234567');
    final (fallback, typed) = splitPhone('98765 43210');
    expect(fallback.code, '+91');
    expect(joinPhone(fallback, typed), '+919876543210');
    expect(joinPhone(uae, '050 123 4567'), '+971501234567');
    expect(joinPhone(uae, ''), '');
  });

  test('Rupees use Indian grouping', () {
    expect(formatRupees(150000), '₹1,50,000');
    expect(formatRupees(99.5), '₹99.50');
    expect(shortRupees(250000), '₹2.5L');
  });

  test('Templates: blanks found and filled', () {
    final parts = TemplateParts({
      'components': [
        {'type': 'HEADER', 'format': 'TEXT', 'text': 'Hello'},
        {'type': 'BODY', 'text': 'Hi {{1}}, your bill {{2}} is ready. Thanks {{1}}!'},
      ],
    });
    expect(parts.header, 'Hello');
    expect(parts.blanks, ['1', '2']);
    expect(parts.fill({'1': 'Priya', '2': 'GLOW-7'}), 'Hi Priya, your bill GLOW-7 is ready. Thanks Priya!');
    expect(parts.fill({'1': 'Priya'}), 'Hi Priya, your bill {{2}} is ready. Thanks Priya!');
  });

  test('Offline: a bill waits on the phone, shows in the list, and syncs once online', () async {
    final (app, backend) = await makeApp();
    final before = FrontDesk(app).invoices.length;
    backend.offline = true;
    await app.counterAction(
      kind: 'bill',
      label: 'Bill for Ravi',
      localId: AppState.newLocalId(),
      resultIdPath: 'invoice.id',
      action: {
        'type': 'walk_in_bill',
        'customer': {'name': 'Ravi'},
        'service_ids': ['s-menscut'],
        'payment_method': 'cash',
      },
      preview: {'customer_name': 'Ravi', 'total': 300, 'status': 'paid', 'payment_method': 'cash', 'issued_at': DateTime.now().toUtc().toIso8601String()},
    );
    await app.flush();
    expect(app.online, isFalse);
    expect(app.waitingCount, 1);
    expect(FrontDesk(app).invoices.first['customer_name'], 'Ravi');
    expect(FrontDesk(app).invoices.first['_outbox'], isNotNull);

    backend.offline = false;
    await app.flush();
    await app.refreshAll();
    expect(app.waitingCount, 0);
    final invoices = FrontDesk(app).invoices;
    expect(invoices.length, before + 1);
    expect(invoices.first['number'], startsWith('GLOW-'));
    expect(invoices.first['_outbox'], isNull);
  });

  test('Offline: a booking and a change to it sync in order, using the server id', () async {
    final (app, backend) = await makeApp();
    backend.offline = true;
    final localId = AppState.newLocalId();
    final start = fromIst(istNow().add(const Duration(days: 1)), 15, 0);
    await app.counterAction(
      kind: 'booking',
      label: 'Book Asha',
      localId: localId,
      resultIdPath: 'appointment.id',
      action: {
        'type': 'create_appointment',
        'customer': {'name': 'Asha'},
        'service_ids': ['s-facial'],
        'starts_at': start.toIso8601String(),
      },
    );
    await app.counterAction(kind: 'appointment', label: 'Asha arrived', action: {'type': 'set_status', 'appointment_id': localId, 'status': 'arrived'});
    await app.flush();
    expect(app.waitingCount, 2);

    backend.offline = false;
    await app.flush();
    expect(app.waitingCount, 0);
    expect(app.store.serverId(localId), isNotNull);
  });

  test('A change the server refuses stops with its reason, and can be discarded', () async {
    final (app, _) = await makeApp();
    await app.counterAction(kind: 'payment', label: 'Pay', action: {'type': 'not_a_thing'});
    await app.flush();
    expect(app.failedCount, 1);
    expect(app.outbox.first.error, 'Unknown action.');
    await app.discard(app.outbox.first);
    expect(app.waitingCount, 0);
  });

  test('Front Desk categories follow the business order', () async {
    final (app, _) = await makeApp();
    expect(FrontDesk(app).categories, ['Hair', 'Skin', 'Nails']);
  });

  test('Knowledge base: answers added and removed offline show at once and sync', () async {
    final (app, backend) = await makeApp();
    final before = articlesOf(app).length;
    backend.offline = true;
    await app.enqueue(kind: 'knowledge', label: 'New answer', path: '/api/knowledge', body: {'type': 'manual', 'title': 'Wi-Fi', 'content': 'Free Wi-Fi: glow-guest'});
    final first = articlesOf(app).last;
    await app.enqueue(kind: 'knowledge', label: 'Remove', method: 'DELETE', path: '/api/knowledge?id=${first['id']}', body: {});
    await app.flush();
    expect(articlesOf(app).length, before);
    expect(articlesOf(app).first['title'], 'Wi-Fi');
    expect(articlesOf(app).first['_waiting'], isTrue);
    backend.offline = false;
    await app.flush();
    await app.refreshAll();
    expect(app.waitingCount, 0);
    expect(articlesOf(app).any((a) => a['title'] == 'Wi-Fi' && a['_waiting'] == null), isTrue);
    expect(articlesOf(app).any((a) => a['id'] == first['id']), isFalse);
  });

  test('AI features need the internet and say so', () async {
    final (app, backend) = await makeApp();
    final rephrased = await app.ask('/api/ai/rephrase', {'text': 'ok we will call you tomorrow', 'tone': 'grammar'});
    expect(rephrased['rephrased'], 'Ok we will call you tomorrow.');
    final suggestions = await app.ask('/api/ai/copilot', {'conversationId': 'conv-5'});
    expect((suggestions['suggestions'] as List).first['article_title'], 'Gold facial');
    backend.offline = true;
    await expectLater(app.ask('/api/ai/rephrase', {'text': 'hi', 'tone': 'short'}), throwsA(predicate((e) => '$e'.contains('needs the internet'))));
    expect(app.online, isFalse);
  });

  test('AI replies on/off for a chat is saved and synced', () async {
    final (app, _) = await makeApp();
    await app.enqueue(kind: 'chat_setting', label: 'AI off', method: 'PATCH', path: '/api/conversations', body: {'conversationId': 'conv-5', 'autoReply': false});
    await app.flush();
    await app.refreshAll();
    final conv = (app.cached('conversations')!['conversations'] as List).firstWhere((c) => c['id'] == 'conv-5');
    expect(conv['auto_reply_enabled'], isFalse);
  });

  test('Sign up: a wrong code is refused; the right one makes the account', () async {
    final (app, _) = await makeApp();
    final form = {'fullName': 'Teja', 'companyName': 'Glow', 'email': 'new@glow.in', 'password': 'secret12'};
    expect(await app.sendSignupCode(form), 60);
    await expectLater(app.createAccount(form, '000000'), throwsA(predicate((e) => '$e'.contains('not right'))));
    await app.createAccount(form, '123456');
    expect(app.signedIn, isTrue);
  });

  test('Booking flow settings saved offline show on the phone straight away', () async {
    final (app, backend) = await makeApp();
    backend.offline = true;
    await app.enqueue(
      kind: 'settings',
      label: 'Booking flow on',
      method: 'PATCH',
      path: '/api/salon/settings',
      body: {
        'organizationId': app.orgId,
        'booking_flow': {
          'enabled': true,
          'triggers': ['book'],
        },
      },
    );
    expect((FrontDesk(app).settings['booking_flow'] as Map)['enabled'], isTrue);
  });

  test('Booking flow steps: defaults, and unfinished steps are caught before saving', () async {
    expect(defaultSteps(true).map((s) => s['type']), ['services', 'staff', 'datetime']);
    expect(
      unfinishedStep([
        {'type': 'services'},
        {
          'type': 'choice',
          'text': 'First visit?',
          'options': ['Yes'],
        },
        {'type': 'datetime'},
      ]),
      'Step 2 needs at least two answers to tap.',
    );
    expect(
      unfinishedStep([
        {'type': 'text', 'text': ' '},
        {'type': 'services'},
        {'type': 'datetime'},
      ]),
      'Write step 1, or remove it.',
    );
    expect(unfinishedStep(defaultSteps(false)), isNull);
    final (app, _) = await makeApp();
    final draft = await app.ask('/api/salon/booking-flow/draft', {'description': 'First visit question, services, allergies, who, day and time'});
    expect(((draft['draft'] as Map)['steps'] as List).length, 6);
  });

  test('Live: a new customer message updates the chat list and notifies; booking requests notify', () async {
    final (app, backend) = await makeApp();
    final notices = <Notice>[];
    final sub = Notifier.instance.notices.listen(notices.add);
    app.startLive();
    await app.checkBookings(); // remembers what is there, no notice
    backend.simulateIncoming();
    await Future<void>.delayed(const Duration(milliseconds: 50));
    final convs = app.cached('conversations')!['conversations'] as List;
    expect(convs.first['id'], 'conv-2');
    expect(convs.first['unread_count'], 1);
    expect(notices.single.title, 'Sneha Reddy');
    expect(notices.single.chatId, 'conv-2');
    await app.checkBookings();
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(notices.last.title, 'New booking request');
    expect(notices.last.body, startsWith('Sneha Reddy · Hair spa · '));
    await sub.cancel();
  });

  test('Live: no notification for the chat that is open', () async {
    final (app, backend) = await makeApp();
    final notices = <Notice>[];
    final sub = Notifier.instance.notices.listen(notices.add);
    app.startLive();
    app.openChatId = 'conv-2';
    backend.simulateIncoming();
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(notices.where((n) => n.chatId != null), isEmpty);
    expect((app.cached('conversations')!['conversations'] as List).first['unread_count'], 0);
    await sub.cancel();
  });

  test('Form checks say what is wrong in plain words', () {
    expect(phoneError('+919876543210'), isNull);
    expect(phoneError('+91987654321'), 'An Indian mobile number has 10 digits (you typed 9).');
    expect(phoneError('+915876543210'), 'An Indian mobile number starts with 6, 7, 8 or 9.');
    expect(phoneError('+971501234567'), isNull);
    expect(phoneError('+97150'), startsWith('That number looks too short'));
    expect(phoneError('', required: true), 'Enter the mobile number.');
    expect(phoneError(''), isNull);
    expect(emailError('priya@gmail.com'), isNull);
    expect(emailError('priya@gmail'), startsWith('That email does not look right'));
    expect(emailError('', required: true), 'Enter your email.');
    expect(textError(' ', what: 'a first name'), 'Enter a first name.');
    expect(textError('ab', what: 'the answer', min: 10), 'The answer is too short (at least 10 letters).');
    expect(passwordError('12345'), 'Use at least 6 letters or numbers.');
  });

  test('Loading shapes show only while nothing is on the phone yet', () async {
    final (app, _) = await makeApp();
    expect(app.isLoading('contacts'), isFalse);
    expect(app.isLoading('never-loaded'), isFalse);
  });
}
