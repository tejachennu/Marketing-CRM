import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'booking_steps.dart';
import 'logic.dart';

const _defaultTriggers = ['book', 'booking', 'appointment', 'బుక్', 'बुक'];
const _welcome = {
  'en': "Hi {name}! Let's book your visit at {business}. Which service would you like?",
  'te': 'Namaste {name} garu! {business} lo mee visit book cheddam. Ee service kavali?',
  'hi': 'Namaste {name}! {business} mein aapki visit book karte hain. Kaunsi service chahiye?',
};

/// The WhatsApp booking flow (same settings as the web): customers send "Book" and pick a
/// service, (who), a day and a time in taps. Managers set it up here; saved offline too.
class BookingFlowScreen extends StatefulWidget {
  const BookingFlowScreen({super.key});
  @override
  State<BookingFlowScreen> createState() => _BookingFlowScreenState();
}

class _BookingFlowScreenState extends State<BookingFlowScreen> {
  late Map<String, dynamic> _flow;
  late bool _autoApprove;
  final _word = TextEditingController();
  late final TextEditingController _welcomeText;

  @override
  void initState() {
    super.initState();
    final desk = FrontDesk(AppScope.read(context));
    final saved = Map<String, dynamic>.from(desk.settings['booking_flow'] as Map? ?? const {});
    _flow = {
      'enabled': saved['enabled'] == true,
      'triggers': List<String>.from((saved['triggers'] as List?)?.map((t) => '$t') ?? _defaultTriggers),
      'welcome': '${saved['welcome'] ?? ''}',
      'ask_staff': saved['ask_staff'] == true,
      'multi_select': saved['multi_select'] != false,
      'days_ahead': (saved['days_ahead'] as num?)?.toInt() ?? 7,
      'language': '${saved['language'] ?? 'en'}',
      'steps': (saved['steps'] as List?)?.isNotEmpty == true ? [for (final x in saved['steps'] as List) Map<String, dynamic>.from(x as Map)] : defaultSteps(saved['ask_staff'] == true),
    };
    if ((_flow['triggers'] as List).isEmpty) _flow['triggers'] = [..._defaultTriggers];
    _autoApprove = desk.settings['auto_approve_bookings'] == true;
    _welcomeText = TextEditingController(text: _flow['welcome']);
  }

  void _set(String key, Object value) => setState(() => _flow[key] = value);

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final desk = FrontDesk(app);
    final triggers = List<String>.from(_flow['triggers']);
    final services = desk.services;
    final welcome = (_welcomeText.text.trim().isEmpty ? _welcome[_flow['language']]! : _welcomeText.text.trim()).replaceAll('{name}', 'Priya').replaceAll('{business}', desk.businessName);
    final phone = '${desk.settings['phone'] ?? ''}'.replaceAll(RegExp(r'\D'), '');
    final link = phone.length >= 10 ? 'https://wa.me/$phone?text=${Uri.encodeComponent(triggers.first[0].toUpperCase() + triggers.first.substring(1))}' : null;

    return Scaffold(
      appBar: AppBar(title: const Text('Booking flow')),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Panel(
                  padding: EdgeInsets.zero,
                  child: SwitchListTile(
                    value: _flow['enabled'] == true,
                    onChanged: (v) => _set('enabled', v),
                    activeThumbColor: Colors.white,
                    activeTrackColor: Brand.blue,
                    title: const Text('Book on WhatsApp in taps', style: TextStyle(fontWeight: FontWeight.w800)),
                    subtitle: const Text('Customers send a word like "Book" and pick service, day and time. No typing, no AI cost.'),
                  ),
                ),
                const SectionLabel('Steps'),
                StepsEditor(
                  steps: List<Map<String, dynamic>>.from(_flow['steps'] as List),
                  onChanged: (steps) => _set('steps', steps),
                  onDraft: (welcome, language) => setState(() {
                    if (welcome != null) _welcomeText.text = welcome;
                    if (language != null) _flow['language'] = language;
                  }),
                ),
                const SizedBox(height: 14),
                Card(
                  child: SwitchListTile(
                    value: _autoApprove,
                    onChanged: (v) => setState(() => _autoApprove = v),
                    activeThumbColor: Colors.white,
                    activeTrackColor: Brand.blue,
                    title: const Text('Accept bookings on their own', style: TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: const Text('On: booked at once and confirmed on WhatsApp. Off: waits on the Front Desk.'),
                  ),
                ),
                if (link != null) ...[
                  const SectionLabel('Share with customers'),
                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          link,
                          style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.blue),
                        ),
                        const SizedBox(height: 6),
                        const Text('Opens WhatsApp with the word typed. Put it on Instagram, Google or a QR at the counter.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
                        const SizedBox(height: 8),
                        OutlinedButton.icon(
                          onPressed: () {
                            Clipboard.setData(ClipboardData(text: link));
                            toast(context, 'Link copied.');
                          },
                          icon: const Icon(Icons.copy, size: 18),
                          label: const Text('Copy link'),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 14),
                Card(
                  clipBehavior: Clip.antiAlias,
                  child: ExpansionTile(
                    title: const Text('More settings', style: TextStyle(fontWeight: FontWeight.w800)),
                    subtitle: const Text('Start words, language, first message, how far ahead, more than one service', style: TextStyle(fontSize: 12.5)),
                    childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const SectionLabel('Words that start it'),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [for (final w in triggers) InputChip(label: Text(w), onDeleted: triggers.length > 1 ? () => _set('triggers', triggers.where((x) => x != w).toList()) : null)],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _word,
                              decoration: const InputDecoration(hintText: 'Add a word, like slot'),
                              onSubmitted: (_) => _addWord(triggers),
                            ),
                          ),
                          const SizedBox(width: 8),
                          OutlinedButton(onPressed: () => _addWord(triggers), child: const Text('Add')),
                        ],
                      ),
                      const SectionLabel('Language of the steps'),
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final (id, label) in [('en', 'English'), ('te', 'Telugu'), ('hi', 'Hindi')])
                            ChoiceChip(label: Text(label), selected: _flow['language'] == id, onSelected: (_) => _set('language', id)),
                        ],
                      ),
                      const SectionLabel('First message'),
                      TextField(
                        controller: _welcomeText,
                        minLines: 2,
                        maxLines: 4,
                        onChanged: (_) => setState(() {}),
                        decoration: InputDecoration(hintText: _welcome[_flow['language']], helperText: '{name}: customer\'s first name · {business}: your name', helperMaxLines: 2),
                      ),
                      const SectionLabel('Book how far ahead'),
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final d in [3, 7, 14, 30]) ChoiceChip(label: Text('$d days'), selected: _flow['days_ahead'] == d, onSelected: (_) => _set('days_ahead', d)),
                        ],
                      ),
                      const SizedBox(height: 14),
                      const SizedBox(height: 10),
                      SwitchListTile(
                        value: _flow['multi_select'] == true,
                        onChanged: (v) => _set('multi_select', v),
                        activeThumbColor: Colors.white,
                        activeTrackColor: Brand.blue,
                        title: const Text('More than one service', style: TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: const Text('Customers tap "Add another" after each service (up to 5)'),
                      ),
                    ],
                  ),
                ),
                const SectionLabel('What the customer sees'),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: const Color(0xFFEFEAE2), borderRadius: BorderRadius.circular(16)),
                  child: Column(
                    children: [
                      ...stepsPreview(
                        steps: List<Map<String, dynamic>>.from(_flow['steps'] as List),
                        welcome: welcome,
                        trigger: triggers.first,
                        services: services,
                        staff: desk.staff,
                        multiSelect: _flow['multi_select'] == true,
                        autoApprove: _autoApprove,
                        business: desk.businessName,
                        chat: (text, {mine = false}) => _Chat(mine: mine, text: text),
                        list: (text, button, rows) => _ListChat(text: text, button: button, rows: rows),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: Brand.line)),
          ),
          child: FilledButton.icon(
            onPressed: () async {
              final steps = List<Map<String, dynamic>>.from(_flow['steps'] as List);
              final problem = unfinishedStep(steps);
              if (problem != null) return toast(context, problem);
              _flow['ask_staff'] = steps.any((x) => x['type'] == 'staff');
              await app.enqueue(
                kind: 'settings',
                label: 'Booking flow ${_flow['enabled'] == true ? 'on' : 'off'}',
                method: 'PATCH',
                path: '/api/salon/settings',
                body: {
                  'organizationId': app.orgId,
                  'booking_flow': {..._flow, 'welcome': _welcomeText.text.trim()},
                  'auto_approve_bookings': _autoApprove,
                },
              );
              if (!context.mounted) return;
              toast(context, app.online ? 'Booking flow saved.' : 'Saved on the phone. It syncs when you are online.');
              Navigator.pop(context);
            },
            icon: const Icon(Icons.check),
            label: const Text('Save booking flow'),
          ),
        ),
      ),
    );
  }

  void _addWord(List<String> triggers) {
    final w = _word.text.trim().toLowerCase();
    if (w.isNotEmpty && !triggers.contains(w) && triggers.length < 12) _set('triggers', [...triggers, w]);
    _word.clear();
  }
}

class _Chat extends StatelessWidget {
  const _Chat({this.mine = false, required this.text});
  final bool mine;
  final String text;
  @override
  Widget build(BuildContext context) => Align(
    alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
    child: Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      constraints: const BoxConstraints(maxWidth: 260),
      decoration: BoxDecoration(color: mine ? const Color(0xFFD9FDD3) : Colors.white, borderRadius: BorderRadius.circular(10)),
      child: Text(text, style: const TextStyle(fontSize: 13)),
    ),
  );
}

class _ListChat extends StatelessWidget {
  const _ListChat({required this.text, required this.button, required this.rows});
  final String text, button;

  /// With no button text, the rows are reply buttons under the message.
  final List<String> rows;
  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.centerLeft,
    child: Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      constraints: const BoxConstraints(maxWidth: 270),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 7, 10, 7),
            child: Text(text, style: const TextStyle(fontSize: 13)),
          ),
          if (button.isEmpty)
            for (final r in rows) ...[
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 7),
                child: Text(
                  '↩  $r',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Color(0xFF027EB5), fontWeight: FontWeight.w600, fontSize: 13),
                ),
              ),
            ]
          else ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 7),
              child: Text(
                '☰  $button',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Color(0xFF027EB5), fontWeight: FontWeight.w600, fontSize: 13),
              ),
            ),
            Container(
              color: Brand.page,
              child: Column(
                children: [
                  for (final r in rows)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              r,
                              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const Icon(Icons.radio_button_unchecked, size: 14, color: Brand.faint),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    ),
  );
}
