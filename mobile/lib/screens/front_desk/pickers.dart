import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'logic.dart';

/// Who the customer is: mobile with country code and a name, with matches from the contacts
/// saved on the phone (so it works offline too).
class CustomerPicker extends StatefulWidget {
  const CustomerPicker({super.key, required this.onChanged, this.optional = false});
  final void Function(Map<String, dynamic> customer) onChanged;
  final bool optional;
  @override
  State<CustomerPicker> createState() => _CustomerPickerState();
}

class _CustomerPickerState extends State<CustomerPicker> {
  String _phone = '';
  final _name = TextEditingController();
  String? _contactId;
  int _phoneVersion = 0;

  void _emit() => widget.onChanged({'contact_id': _contactId, 'name': _name.text.trim(), 'phone': _phone});

  List<Map<String, dynamic>> _matches(AppState app) {
    final digits = _phone.replaceAll(RegExp(r'\D'), '');
    final local = digits.length > 10 ? digits.substring(digits.length - 10) : digits;
    final word = _name.text.trim().toLowerCase();
    if (_contactId != null || (local.length < 4 && word.length < 2)) return const [];
    final contacts = [for (final c in ((app.cached('contacts') ?? const {})['contacts'] as List? ?? const [])) Map<String, dynamic>.from(c)];
    return contacts.where((c) {
      final phone = '${c['phone_number'] ?? ''}'.replaceAll(RegExp(r'\D'), '');
      if (local.length >= 4) return phone.contains(local.substring(local.length > 6 ? local.length - 6 : 0));
      return contactName(c).toLowerCase().contains(word);
    }).take(4).toList();
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final matches = _matches(app);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      PhoneField(
        key: ValueKey(_phoneVersion),
        value: _phone,
        label: widget.optional ? 'Mobile (optional)' : 'Mobile number',
        onChanged: (v) => setState(() {
          _phone = v;
          _contactId = null;
          _emit();
        }),
      ),
      const SizedBox(height: 10),
      TextField(
        controller: _name,
        textCapitalization: TextCapitalization.words,
        decoration: InputDecoration(labelText: widget.optional ? 'Name (optional)' : 'Name', hintText: widget.optional ? 'Walk-in customer' : 'Priya'),
        onChanged: (_) => setState(() {
          _contactId = null;
          _emit();
        }),
      ),
      if (_contactId != null)
        const Padding(padding: EdgeInsets.only(top: 8), child: Row(children: [Icon(Icons.check_circle, size: 16, color: Brand.blue), SizedBox(width: 6), Text('From your contacts', style: TextStyle(color: Brand.blue, fontWeight: FontWeight.w600, fontSize: 13))])),
      if (matches.isNotEmpty) ...[
        const SizedBox(height: 10),
        Card(
          child: Column(children: [
            for (final c in matches)
              ListTile(
                dense: true,
                leading: Avatar(contactName(c), size: 34),
                title: Text(contactName(c), style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${c['phone_number'] ?? ''}'),
                trailing: const Text('Pick', style: TextStyle(color: Brand.blue, fontWeight: FontWeight.w700)),
                onTap: () => setState(() {
                  _contactId = '${c['id']}';
                  _phone = '${c['phone_number'] ?? ''}';
                  _phoneVersion++;
                  _name.text = contactName(c);
                  _emit();
                }),
              ),
          ]),
        ),
      ],
    ]);
  }
}

/// Services by category, tap to add or remove.
class ServicePicker extends StatefulWidget {
  const ServicePicker({super.key, required this.desk, required this.selected, required this.onChanged});
  final FrontDesk desk;
  final List<String> selected;
  final ValueChanged<List<String>> onChanged;
  @override
  State<ServicePicker> createState() => _ServicePickerState();
}

class _ServicePickerState extends State<ServicePicker> {
  String _category = 'All';

  @override
  Widget build(BuildContext context) {
    final categories = ['All', ...widget.desk.categories];
    final shown = widget.desk.services.where((s) => _category == 'All' || '${s['category'] ?? 'General'}'.toLowerCase() == _category.toLowerCase()).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SizedBox(
        height: 40,
        child: ListView(scrollDirection: Axis.horizontal, children: [
          for (final c in categories)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(label: Text(c), selected: _category == c, onSelected: (_) => setState(() => _category = c)),
            ),
        ]),
      ),
      const SizedBox(height: 10),
      Card(
        child: Column(children: [
          for (var i = 0; i < shown.length; i++) ...[
            if (i > 0) const Divider(indent: 16),
            _row(shown[i]),
          ],
        ]),
      ),
    ]);
  }

  Widget _row(Map<String, dynamic> s) {
    final on = widget.selected.contains(s['id']);
    return InkWell(
      onTap: () => widget.onChanged(on ? (widget.selected.toList()..remove(s['id'])) : [...widget.selected, '${s['id']}']),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            width: 24,
            height: 24,
            decoration: BoxDecoration(color: on ? Brand.blue : Colors.white, borderRadius: BorderRadius.circular(7), border: Border.all(color: on ? Brand.blue : Brand.border, width: 1.5)),
            child: on ? const Icon(Icons.check, size: 16, color: Colors.white) : null,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${s['name']}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
              Text('${s['duration_minutes']} min${_category == 'All' ? ' · ${s['category'] ?? 'General'}' : ''}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
            ]),
          ),
          Text(formatRupees(s['price']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        ]),
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
  Widget build(BuildContext context) => Wrap(spacing: 8, runSpacing: 8, children: [
        ChoiceChip(label: const Text('Anyone'), selected: value == null, onSelected: (_) => onChanged(null)),
        for (final s in desk.staff) ChoiceChip(avatar: value == s['id'] ? null : Avatar('${s['name']}', size: 20), label: Text('${s['name']}'), selected: value == s['id'], onSelected: (_) => onChanged('${s['id']}')),
      ]);
}

class FormSection extends StatelessWidget {
  const FormSection({super.key, required this.title, required this.child, this.hint});
  final String title;
  final String? hint;
  final Widget child;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 20),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
          if (hint != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(hint!, style: const TextStyle(fontSize: 12.5, color: Brand.muted))),
          const SizedBox(height: 10),
          child,
        ]),
      );
}
