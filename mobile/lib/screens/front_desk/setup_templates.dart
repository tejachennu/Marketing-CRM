import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Which WhatsApp template goes out for each automatic message (bill, booking, reminder,
/// feedback), and what fills each of its blanks. Customers who have not written in 24 hours get
/// only these. As on the web: pick one of your approved templates, or send the suggested one to
/// Meta for approval.

const purposes = {
  'bill': ('Bill', 'Sends the bill with a link to view it', ['first_name', 'customer_name', 'business', 'bill_number', 'amount', 'services', 'staff', 'date', 'link']),
  'booking': ('Booking confirmed', 'Confirms a booking from the counter or the chat', ['first_name', 'customer_name', 'business', 'date_time', 'date', 'time', 'services', 'staff', 'visit']),
  'reminder': ('Appointment reminder', 'About 2 hours before the appointment', ['first_name', 'customer_name', 'business', 'time', 'date', 'services', 'staff', 'visit']),
  'feedback': ('Feedback request', 'Asks how the visit was, with a link to the form', ['first_name', 'customer_name', 'business', 'services', 'staff', 'link']),
};

const fieldLabels = {
  'first_name': 'Customer first name',
  'customer_name': 'Customer full name',
  'business': 'Business name',
  'bill_number': 'Bill number',
  'amount': 'Bill amount',
  'services': 'Services',
  'staff': 'Staff name',
  'visit': 'Services with staff',
  'date_time': 'Date and time',
  'date': 'Date',
  'time': 'Time',
  'link': 'Link code',
};

class TemplatesSetup extends StatefulWidget {
  const TemplatesSetup({super.key});
  @override
  State<TemplatesSetup> createState() => _TemplatesSetupState();
}

class _TemplatesSetupState extends State<TemplatesSetup> {
  Map<String, dynamic>? _data;
  String? _error;

  Future<void> _load() async {
    try {
      final app = AppScope.read(context);
      final data = await app.backend.get('/api/salon/templates', {'organizationId': app.orgId});
      if (mounted) setState(() => _data = data);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _save(Map<String, dynamic> choices) async {
    final app = AppScope.read(context);
    try {
      await app.ask('/api/salon/templates', {'choices': choices}, method: 'PUT');
      await app.load('setup', '/api/salon/setup', force: true);
      await _load();
      if (mounted) toast(context, 'Saved.');
    } catch (e) {
      if (mounted) toast(context, '$e'.replaceFirst('Exception: ', ''));
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final choices = Map<String, dynamic>.from(data?['choices'] as Map? ?? const {});
    return Scaffold(
      appBar: AppBar(title: const Text('Message templates')),
      body: data == null
          ? (_error != null
                ? EmptyState(
                    icon: Icons.wifi_off,
                    title: 'Could not load',
                    text: '$_error'.replaceFirst('Exception: ', ''),
                    action: OutlinedButton(onPressed: _load, child: const Text('Try again')),
                  )
                : const SkeletonCards(tiles: false))
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(
                  data['connected'] == false
                      ? '${data['message'] ?? 'Connect WhatsApp on the web to use templates.'}'
                      : 'WhatsApp only delivers a template to customers who have not written in 24 hours. Nothing goes from a template until you set it up here.',
                  style: TextStyle(color: data['connected'] == false ? Brand.red : Brand.textSoft, height: 1.4),
                ),
                const SizedBox(height: 12),
                for (final e in purposes.entries) ...[
                  Panel(
                    onTap: data['connected'] == false ? null : () => _edit(e.key, data),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(e.value.$1, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15.5)),
                              Text(e.value.$2, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                              const SizedBox(height: 6),
                              choices[e.key] == null ? const Pill('Not set up', tone: PillTone.red) : Pill('${choices[e.key]['name']}', tone: PillTone.blue, icon: Icons.check),
                            ],
                          ),
                        ),
                        const Icon(Icons.chevron_right, color: Brand.faint),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
              ],
            ),
    );
  }

  Future<void> _edit(String purpose, Map<String, dynamic> data) async {
    final account = [for (final t in (data['account'] as List? ?? const [])) Map<String, dynamic>.from(t)].where((t) => t['status'] == 'APPROVED').toList();
    final choices = Map<String, dynamic>.from(data['choices'] as Map? ?? const {});
    final current = choices[purpose] == null ? null : Map<String, dynamic>.from(choices[purpose] as Map);
    final suggestion = Map<String, dynamic>.from((data['suggestions'] as Map?)?[purpose] as Map? ?? const {});
    final allowed = purposes[purpose]!.$3.where((f) => f != 'link').toList();
    Map<String, dynamic>? picked = current == null ? null : account.cast<Map<String, dynamic>?>().firstWhere((t) => t!['name'] == current['name'], orElse: () => null);
    var fields = List<String>.from((current?['fields'] as List?) ?? const []);
    var urlField = current?['url_field'] as String?;
    final body = TextEditingController(text: '${(suggestion['draft'] as Map?)?['body'] ?? ''}');
    var useSuggestion = false;
    String? error;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheet) => StatefulBuilder(
        builder: (sheet, set) {
          final blanks = (picked?['blanks'] as num?)?.toInt() ?? 0;
          while (fields.length < blanks) {
            fields.add(allowed[fields.length.clamp(0, allowed.length - 1)]);
          }
          if (fields.length > blanks) fields = fields.sublist(0, blanks);
          return Padding(
            padding: EdgeInsets.fromLTRB(20, 0, 20, 16 + MediaQuery.of(sheet).viewInsets.bottom),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(purposes[purpose]!.$1, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 10),
                  SegmentedButton<bool>(
                    showSelectedIcon: false,
                    style: SegmentedButton.styleFrom(selectedBackgroundColor: Brand.navy, selectedForegroundColor: Colors.white),
                    segments: const [
                      ButtonSegment(value: false, label: Text('Use my template')),
                      ButtonSegment(value: true, label: Text('Use suggested')),
                    ],
                    selected: {useSuggestion},
                    onSelectionChanged: (s) => set(() => useSuggestion = s.first),
                  ),
                  const SizedBox(height: 12),
                  if (!useSuggestion) ...[
                    if (account.isEmpty) const Text('No approved templates yet. Use the suggested one, or create one on the web.', style: TextStyle(color: Brand.muted)),
                    for (final t in account)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(
                          picked != null && picked!['name'] == t['name'] && picked!['language'] == t['language'] ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                          color: Brand.blue,
                        ),
                        onTap: () => set(() {
                          picked = t;
                          fields = [];
                          urlField = t['urlButton'] == true ? 'link' : null;
                        }),
                        title: Text('${t['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text('${t['body']}', maxLines: 2, overflow: TextOverflow.ellipsis),
                      ),
                    if (picked != null && blanks > 0) ...[
                      const SizedBox(height: 8),
                      const Text('What fills each blank', style: TextStyle(fontWeight: FontWeight.w800)),
                      for (var i = 0; i < blanks; i++)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: DropdownButtonFormField<String>(
                            initialValue: fields[i],
                            decoration: InputDecoration(labelText: 'Blank {{${i + 1}}}'),
                            items: [for (final f in allowed) DropdownMenuItem(value: f, child: Text(fieldLabels[f]!))],
                            onChanged: (v) => set(() => fields[i] = v ?? fields[i]),
                          ),
                        ),
                    ],
                    if (picked != null && picked!['urlButton'] == true)
                      const Padding(
                        padding: EdgeInsets.only(top: 8),
                        child: Text('Its link button opens the bill or the feedback form.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
                      ),
                  ] else ...[
                    const Text(
                      'This goes to Meta for approval (usually minutes to a day). You can change the words; keep the blanks {{1}}, {{2}}…',
                      style: TextStyle(fontSize: 12.5, color: Brand.muted),
                    ),
                    const SizedBox(height: 8),
                    TextField(controller: body, minLines: 3, maxLines: 6, onChanged: (_) => set(() => error = null)),
                    const SizedBox(height: 6),
                    Text(
                      'Blanks: ${[for (final f in (suggestion['fields'] as List? ?? const [])) fieldLabels['$f']].asMap().entries.map((e) => '{{${e.key + 1}}} ${e.value}').join(' · ')}',
                      style: const TextStyle(fontSize: 12.5, color: Brand.textSoft),
                    ),
                  ],
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        error!,
                        style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600),
                      ),
                    ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      if (current != null)
                        Expanded(
                          child: OutlinedButton(
                            style: OutlinedButton.styleFrom(foregroundColor: Brand.red),
                            onPressed: () async {
                              Navigator.pop(sheet);
                              await _save({...choices}..remove(purpose));
                            },
                            child: const Text('Stop using'),
                          ),
                        ),
                      if (current != null) const SizedBox(width: 10),
                      Expanded(
                        child: FilledButton(
                          onPressed: () async {
                            if (!useSuggestion) {
                              if (picked == null) return set(() => error = 'Pick a template.');
                              Navigator.pop(sheet);
                              await _save({
                                ...choices,
                                purpose: {'name': picked!['name'], 'language': picked!['language'], 'fields': fields, 'url_field': picked!['urlButton'] == true ? (urlField ?? 'link') : null},
                              });
                              return;
                            }
                            final wanted = (suggestion['fields'] as List? ?? const []).length;
                            final found = RegExp(r'\{\{\s*(\d+)\s*\}\}').allMatches(body.text).map((m) => m.group(1)).toSet().length;
                            if (body.text.trim().length < 10) return set(() => error = 'Write the message.');
                            if (found != wanted) return set(() => error = 'Keep all $wanted blanks ({{1}} to {{$wanted}}).');
                            final app = AppScope.read(context);
                            try {
                              final draft = {...Map<String, dynamic>.from(suggestion['draft'] as Map), 'body': body.text.trim()};
                              await app.ask('/api/whatsapp-templates', {'draft': draft});
                              if (sheet.mounted) Navigator.pop(sheet);
                              await _save({
                                ...choices,
                                purpose: {'name': draft['name'], 'language': draft['language'] ?? 'en', 'fields': suggestion['fields'], 'url_field': suggestion['urlField']},
                              });
                              if (mounted) toast(context, 'Sent to Meta. It works once approved.');
                            } catch (e) {
                              set(() => error = '$e'.replaceFirst('Exception: ', ''));
                            }
                          },
                          child: Text(useSuggestion ? 'Send for approval' : 'Save'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
