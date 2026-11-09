import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'logic.dart';

/// Who the customer is: mobile with country code and a name. Matches come from the server (with
/// how many visits and what they had last time, for "Same as last time") and, offline, from the
/// contacts saved on the phone.
class CustomerPicker extends StatefulWidget {
  const CustomerPicker({super.key, required this.onChanged, this.optional = false, this.phoneError, this.nameError, this.onRepeat});
  final void Function(Map<String, dynamic> customer) onChanged;
  final bool optional;

  /// Problems to show under the fields (after Save was tapped), or null.
  final String? phoneError;
  final String? nameError;

  /// "Same as last time": the services and who did them on their last visit.
  final void Function(List<String> serviceIds, List<String?> staffIds)? onRepeat;
  @override
  State<CustomerPicker> createState() => _CustomerPickerState();
}

class _CustomerPickerState extends State<CustomerPicker> {
  String _phone = '';
  final _name = TextEditingController();
  String? _contactId;
  int _phoneVersion = 0;
  List<Map<String, dynamic>> _remote = const [];
  Map<String, dynamic>? _picked;
  Timer? _debounce;
  int _seq = 0;

  @override
  void dispose() {
    _debounce?.cancel();
    _name.dispose();
    super.dispose();
  }

  void _emit() => widget.onChanged({'contact_id': _contactId, 'name': _name.text.trim(), 'phone': _phone});

  String get _typed {
    final digits = _phone.replaceAll(RegExp(r'\D'), '');
    final local = digits.length > 10 ? digits.substring(digits.length - 10) : digits;
    return local.length >= 4 ? local : _name.text.trim();
  }

  /// Ask the server who this could be (online): visits and last visit come with it.
  void _lookUp() {
    _debounce?.cancel();
    final typed = _typed;
    if (_contactId != null || typed.length < 2) {
      if (_remote.isNotEmpty) setState(() => _remote = const []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      final app = AppScope.read(context);
      if (!app.online) return;
      final seq = ++_seq;
      try {
        final data = await app.backend.get('/api/salon/customers', {'organizationId': app.orgId, 'q': typed});
        if (!mounted || seq != _seq) return;
        setState(() => _remote = [for (final c in (data['customers'] as List? ?? const [])) Map<String, dynamic>.from(c)]);
      } catch (_) {}
    });
  }

  List<Map<String, dynamic>> _matches(AppState app) {
    if (_contactId != null) return const [];
    final digits = _phone.replaceAll(RegExp(r'\D'), '');
    final local = digits.length > 10 ? digits.substring(digits.length - 10) : digits;
    final word = _name.text.trim().toLowerCase();
    if (local.length < 4 && word.length < 2) return const [];
    final contacts = [for (final c in ((app.cached('contacts') ?? const {})['contacts'] as List? ?? const [])) Map<String, dynamic>.from(c)];
    final offline = contacts
        .where((c) {
          final phone = '${c['phone_number'] ?? ''}'.replaceAll(RegExp(r'\D'), '');
          if (local.length >= 4) return phone.contains(local.substring(local.length > 6 ? local.length - 6 : 0));
          return contactName(c).toLowerCase().contains(word);
        })
        .map((c) => {'contact_id': c['id'], 'name': contactName(c), 'phone': c['phone_number'], 'visits': null});
    final seen = {for (final r in _remote) '${r['contact_id']}'};
    return [..._remote, ...offline.where((c) => !seen.contains('${c['contact_id']}'))].take(5).toList();
  }

  void _pick(Map<String, dynamic> c) => setState(() {
    _contactId = '${c['contact_id']}';
    _picked = c;
    _phone = '${c['phone'] ?? ''}';
    _phoneVersion++;
    _name.text = '${c['name'] ?? ''}';
    _remote = const [];
    _emit();
  });

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final matches = _matches(app);
    final last = _picked?['last_visit'] as Map?;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PhoneField(
          key: ValueKey(_phoneVersion),
          value: _phone,
          label: widget.optional ? 'Mobile (optional)' : 'Mobile number',
          errorText: widget.phoneError,
          onChanged: (v) => setState(() {
            _phone = v;
            _contactId = null;
            _picked = null;
            _emit();
            _lookUp();
          }),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: _name,
          textCapitalization: TextCapitalization.words,
          decoration: InputDecoration(labelText: widget.optional ? 'Name (optional)' : 'Name', hintText: widget.optional ? 'Walk-in customer' : 'Priya', errorText: widget.nameError),
          onChanged: (_) => setState(() {
            _contactId = null;
            _picked = null;
            _emit();
            _lookUp();
          }),
        ),
        if (_contactId != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(
              children: [
                const Icon(Icons.check_circle, size: 16, color: Brand.blue),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _picked?['visits'] == null
                        ? 'From your contacts'
                        : (_picked!['visits'] as num) > 0
                        ? '${_picked!['visits']} visit${_picked!['visits'] == 1 ? '' : 's'}${last != null ? ' · last ${formatDay(DateTime.parse('${last['date']}'))}' : ''}'
                        : 'First visit',
                    style: const TextStyle(color: Brand.blue, fontWeight: FontWeight.w600, fontSize: 13),
                  ),
                ),
              ],
            ),
          ),
        if (last != null && widget.onRepeat != null && (last['service_ids'] as List? ?? const []).isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: OutlinedButton.icon(
              onPressed: () => widget.onRepeat!([for (final id in last['service_ids'] as List) '$id'], [for (final id in (last['staff_ids'] as List? ?? const [])) id == null ? null : '$id']),
              icon: const Icon(Icons.replay, size: 18),
              label: Text('Same as last time: ${(last['services'] as List? ?? const []).join(', ')}', overflow: TextOverflow.ellipsis),
            ),
          ),
        if (matches.isNotEmpty) ...[
          const SizedBox(height: 10),
          Card(
            child: Column(
              children: [
                for (final c in matches)
                  ListTile(
                    dense: true,
                    leading: Avatar('${c['name']}', size: 34),
                    title: Text('${c['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text('${c['phone'] ?? 'No number'}${c['last_visit'] != null ? ' · last ${formatDay(DateTime.parse('${c['last_visit']['date']}'))}' : ''}'),
                    trailing: (c['visits'] as num?) != null && (c['visits'] as num) > 0
                        ? Pill('${c['visits']} visit${c['visits'] == 1 ? '' : 's'}', tone: PillTone.blue)
                        : const Text(
                            'Pick',
                            style: TextStyle(color: Brand.blue, fontWeight: FontWeight.w700),
                          ),
                    onTap: () => _pick(c),
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

/// Services by category, tap to add or remove.
class ServicePicker extends StatefulWidget {
  const ServicePicker({super.key, required this.desk, required this.selected, required this.onChanged, this.forBill = false});
  final FrontDesk desk;
  final List<String> selected;
  final ValueChanged<List<String>> onChanged;

  /// Leave out services set not to go on bills.
  final bool forBill;
  @override
  State<ServicePicker> createState() => _ServicePickerState();
}

class _ServicePickerState extends State<ServicePicker> {
  String _category = 'All';

  @override
  Widget build(BuildContext context) {
    final list = widget.forBill ? widget.desk.billServices : widget.desk.services;
    String cat(Map s) => '${s['category'] ?? 'General'}'.toLowerCase();
    final categories = ['All', ...widget.desk.categories.where((c) => list.any((s) => cat(s) == c.toLowerCase()))];
    final shown = list.where((s) => _category == 'All' || cat(s) == _category.toLowerCase()).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: 40,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (final c in categories)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(label: Text(c), selected: _category == c, onSelected: (_) => setState(() => _category = c)),
                ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Card(
          child: Column(
            children: [
              for (var i = 0; i < shown.length; i++) ...[if (i > 0) const Divider(indent: 16), _row(shown[i])],
            ],
          ),
        ),
      ],
    );
  }

  Widget _row(Map<String, dynamic> s) {
    final on = widget.selected.contains(s['id']);
    return InkWell(
      onTap: () => widget.onChanged(on ? (widget.selected.toList()..remove(s['id'])) : [...widget.selected, '${s['id']}']),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: on ? Brand.blue : Colors.white,
                borderRadius: BorderRadius.circular(7),
                border: Border.all(color: on ? Brand.blue : Brand.border, width: 1.5),
              ),
              child: on ? const Icon(Icons.check, size: 16, color: Colors.white) : null,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${s['name']}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                  Text('${s['duration_minutes']} min${_category == 'All' ? ' · ${s['category'] ?? 'General'}' : ''}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                ],
              ),
            ),
            Text(formatRupees(s['price']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
          ],
        ),
      ),
    );
  }
}

/// Who does the work (one tap; "Anyone" leaves it open).
class StaffPicker extends StatelessWidget {
  const StaffPicker({super.key, required this.desk, required this.value, required this.onChanged});
  final FrontDesk desk;
  final String? value;
  final ValueChanged<String?> onChanged;
  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: [
      ChoiceChip(label: const Text('Anyone'), selected: value == null, onSelected: (_) => onChanged(null)),
      for (final s in desk.staff)
        ChoiceChip(avatar: value == s['id'] ? null : Avatar('${s['name']}', size: 20), label: Text('${s['name']}'), selected: value == s['id'], onSelected: (_) => onChanged('${s['id']}')),
    ],
  );
}

class FormSection extends StatelessWidget {
  const FormSection({super.key, required this.title, required this.child, this.hint});
  final String title;
  final String? hint;
  final Widget child;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
        if (hint != null)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(hint!, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          ),
        const SizedBox(height: 10),
        child,
      ],
    ),
  );
}

/// Who did each service. One service: one row of names. More: a row per service, with only the
/// people who do that service. Tapping a name for one service fills it for the others they do.
class WhoDidIt extends StatelessWidget {
  const WhoDidIt({super.key, required this.desk, required this.serviceIds, required this.value, required this.onChanged});
  final FrontDesk desk;
  final List<String> serviceIds;
  final Map<String, String?> value;
  final ValueChanged<Map<String, String?>> onChanged;

  bool _does(Map<String, dynamic> member, String serviceId) {
    final ids = (member['service_ids'] as List? ?? const []);
    return ids.isEmpty || ids.contains(serviceId);
  }

  @override
  Widget build(BuildContext context) {
    if (desk.staff.isEmpty) return const Text('Add your team in Setup to say who did the work.', style: TextStyle(color: Brand.muted));
    if (serviceIds.isEmpty) return const Text('Choose services first.', style: TextStyle(color: Brand.muted));
    Widget chips(String serviceId) => Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        ChoiceChip(label: const Text('Anyone'), selected: value[serviceId] == null, onSelected: (_) => onChanged({...value, serviceId: null})),
        for (final m in desk.staff.where((m) => _does(m, serviceId)))
          ChoiceChip(
            label: Text('${m['name']}'),
            selected: value[serviceId] == m['id'],
            onSelected: (_) {
              final next = {...value, serviceId: '${m['id']}'};
              // Fill their other services that nobody is on yet
              for (final other in serviceIds) {
                if (other != serviceId && next[other] == null && _does(m, other)) next[other] = '${m['id']}';
              }
              onChanged(next);
            },
          ),
      ],
    );
    if (serviceIds.length == 1) return chips(serviceIds.first);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final id in serviceIds) ...[
          Text('${desk.service(id)?['name'] ?? 'Service'}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
          const SizedBox(height: 4),
          chips(id),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}

/// A discount: none, a percent, or rupees off.
class DiscountPicker extends StatelessWidget {
  const DiscountPicker({super.key, required this.value, required this.onChanged, this.max});

  /// {'type': 'percent'|'amount', 'value': n} or null.
  final Map<String, num>? value;
  final ValueChanged<Map<String, num>?> onChanged;
  final num? max;

  @override
  Widget build(BuildContext context) {
    final isAmount = value?['type'] == 1;
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        ChoiceChip(label: const Text('None'), selected: value == null, onSelected: (_) => onChanged(null)),
        for (final p in [5, 10, 15, 20]) ChoiceChip(label: Text('$p%'), selected: !isAmount && value?['value'] == p, onSelected: (_) => onChanged({'type': 0, 'value': p})),
        ChoiceChip(
          label: Text(isAmount ? '₹${value!['value']} off' : '₹ off'),
          selected: isAmount,
          onSelected: (_) async {
            final controller = TextEditingController(text: isAmount ? '${value!['value']}' : '');
            final typed = await showDialog<num>(
              context: context,
              builder: (d) => AlertDialog(
                title: const Text('Rupees off'),
                content: TextField(
                  controller: controller,
                  autofocus: true,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(prefixText: '₹ ', hintText: '100'),
                ),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
                  TextButton(onPressed: () => Navigator.pop(d, num.tryParse(controller.text.trim())), child: const Text('Apply')),
                ],
              ),
            );
            if (typed == null) return;
            if (typed <= 0 || (max != null && typed > max!)) {
              if (context.mounted) toast(context, max != null && typed > max! ? 'The discount cannot be more than the bill (${formatRupees(max)}).' : 'Enter an amount above ₹0.');
              return;
            }
            onChanged({'type': 1, 'value': typed});
          },
        ),
      ],
    );
  }
}

/// The discount as the server takes it.
Map<String, dynamic>? discountBody(Map<String, num>? d) => d == null ? null : {'type': d['type'] == 1 ? 'amount' : 'percent', 'value': d['value']};
