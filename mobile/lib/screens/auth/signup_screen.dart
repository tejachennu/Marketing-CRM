import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/validate.dart';
import '../../ui/widgets.dart';
import 'auth_parts.dart';

/// Sign up in three short steps: 1. the business (name, owner, mobile), 2. the login (email and password),
/// 3. the 6-digit code we email. The account is made only once the code is right (it proves the email is
/// theirs). When the server needs no code, step 2 makes the account straight away. Needs the internet.
class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key, this.demoCodeStep = false});

  /// Demo screenshots: open on the code step.
  final bool demoCodeStep;
  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _name = TextEditingController();
  final _business = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  final _nameFocus = FocusNode();
  final _passwordFocus = FocusNode();
  String _phone = '';
  int _step = 0; // 0 business, 1 login, 2 code
  bool _busy = false;
  bool _hide = true;
  bool _triedBusiness = false;
  bool _triedLogin = false;
  bool _codeWrong = false;
  String? _error;
  int _resendIn = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    if (widget.demoCodeStep) {
      _name.text = 'Teja';
      _business.text = 'Sri Lakshmi Fashions';
      _phone = '+919876543210';
      _email.text = 'owner@srilakshmifashions.in';
      _password.text = 'secret12';
      _step = 2;
      _startTimer(42);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    for (final c in [_name, _business, _email, _password, _code]) {
      c.dispose();
    }
    _nameFocus.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  Map<String, String> get _form => {'fullName': _name.text.trim(), 'companyName': _business.text.trim(), 'phone': _phone, 'email': _email.text.trim().toLowerCase(), 'password': _password.text};

  void _startTimer(int seconds) {
    _timer?.cancel();
    setState(() => _resendIn = seconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted || _resendIn <= 1) t.cancel();
      if (!mounted) return;
      setState(() => _resendIn = (_resendIn - 1).clamp(0, 999));
    });
  }

  String? get _businessErr => _triedBusiness ? textError(_business.text, what: 'your business name', min: 2, max: 80) : null;
  String? get _nameErr => _triedBusiness ? textError(_name.text, what: 'your name', min: 2, max: 80) : null;
  String? get _phoneErr => _triedBusiness ? phoneError(_phone, required: true) : null;
  String? get _emailErr => _triedLogin ? emailError(_email.text, required: true) : null;
  String? get _passwordErr => _triedLogin ? passwordError(_password.text) : null;

  Future<void> _run(Future<void> Function() task, {bool checksCode = false}) async {
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
      _codeWrong = false;
    });
    try {
      await task();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = friendlyAuthError(e);
          _codeWrong = checksCode;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _go(int step) => setState(() {
    _step = step;
    _error = null;
    _codeWrong = false;
  });

  void _next() {
    setState(() => _triedBusiness = true);
    if ((_businessErr ?? _nameErr ?? _phoneErr) != null) return;
    FocusScope.of(context).unfocus();
    _go(1);
  }

  void _back() {
    if (_busy) return;
    if (_step == 0) {
      Navigator.of(context).maybePop();
    } else {
      _go(_step - 1);
    }
  }

  Future<void> _sendCode() async {
    setState(() => _triedLogin = true);
    if ((_emailErr ?? _passwordErr) != null) return;
    await _run(() async {
      final app = AppScope.read(context);
      final wait = await app.sendSignupCode(_form);
      // The server needs no code: the account is made now
      if (wait == null) {
        await app.createAccount(_form, '');
        if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
        return;
      }
      _code.clear();
      _go(2);
      _startTimer(wait);
    });
  }

  Future<void> _create() async {
    if (_code.text.trim().length != CodeBoxes.length || _busy) return;
    await _run(() async {
      await AppScope.read(context).createAccount(_form, _code.text.trim());
      if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
    }, checksCode: true);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _step == 0 && !_busy,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        appBar: AppBar(
          leading: IconButton(icon: const Icon(Icons.arrow_back), tooltip: 'Back', onPressed: _busy ? null : _back),
          title: Text(_step == 2 ? 'Check your email' : 'Create your account'),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(14),
            child: Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 9), child: StepBar(step: _step, steps: 3)),
          ),
        ),
        body: SafeArea(
          top: false,
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 220),
            child: KeyedSubtree(
              key: ValueKey(_step),
              child: switch (_step) {
                0 => _businessStep(),
                1 => _loginStep(),
                _ => _codeStep(),
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _scroll(List<Widget> children) => SingleChildScrollView(
    keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
    padding: const EdgeInsets.fromLTRB(22, 14, 22, 24),
    child: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 440),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
      ),
    ),
  );

  double get _pictureHeight => (MediaQuery.sizeOf(context).height * 0.2).clamp(96.0, 170.0);

  Widget _title(String title, String text) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(title, style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w700, letterSpacing: -0.4, height: 1.2, color: Brand.navy)),
      const SizedBox(height: 6),
      Text(text, style: const TextStyle(color: Brand.textSoft, fontSize: 15, height: 1.42)),
    ],
  );

  // ── Step 1: the business ──

  Widget _businessStep() => _scroll([
    AuthPicture('signup', aspect: 360 / 176, maxHeight: _pictureHeight),
    const SizedBox(height: 16),
    _title('Start your free trial', 'Tell us about your business. It takes a minute.'),
    const SizedBox(height: 12),
    const Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        SoftPill(icon: Icons.card_giftcard_outlined, label: '14 days free'),
        SoftPill(icon: Icons.credit_card_off_outlined, label: 'No card needed'),
      ],
    ),
    const SizedBox(height: 22),
    TextField(
      controller: _business,
      textCapitalization: TextCapitalization.words,
      textInputAction: TextInputAction.next,
      onChanged: (_) => _triedBusiness ? setState(() {}) : null,
      onSubmitted: (_) => _nameFocus.requestFocus(),
      decoration: InputDecoration(labelText: 'Business name', hintText: 'e.g. Sri Lakshmi Fashions', prefixIcon: const Icon(Icons.storefront_outlined), errorText: _businessErr),
    ),
    const SizedBox(height: 14),
    TextField(
      controller: _name,
      focusNode: _nameFocus,
      textCapitalization: TextCapitalization.words,
      textInputAction: TextInputAction.next,
      autofillHints: const [AutofillHints.name],
      onChanged: (_) => _triedBusiness ? setState(() {}) : null,
      decoration: InputDecoration(labelText: 'Your name', prefixIcon: const Icon(Icons.person_outline), errorText: _nameErr),
    ),
    const SizedBox(height: 14),
    PhoneField(value: _phone, label: 'Mobile number', errorText: _phoneErr, onChanged: (v) => setState(() => _phone = v)),
    const SizedBox(height: 24),
    BigButton(label: 'Next', icon: Icons.arrow_forward, onPressed: _next),
    const SizedBox(height: 14),
    const TermsLine(),
  ]);

  // ── Step 2: the login ──

  Widget _loginStep() => _scroll([
    Align(
      alignment: Alignment.centerLeft,
      child: Container(
        width: 56,
        height: 56,
        decoration: BoxDecoration(color: Brand.blueSoft, borderRadius: BorderRadius.circular(16)),
        child: const Icon(Icons.lock_person_outlined, color: Brand.blue, size: 28),
      ),
    ),
    const SizedBox(height: 16),
    _title('Create your login', 'You will use this email and password to sign in on this app and on the website.'),
    const SizedBox(height: 22),
    AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.next,
            autocorrect: false,
            autofillHints: const [AutofillHints.email],
            onChanged: (_) => _triedLogin ? setState(() {}) : null,
            onSubmitted: (_) => _passwordFocus.requestFocus(),
            decoration: InputDecoration(labelText: 'Email', prefixIcon: const Icon(Icons.mail_outline), errorText: _emailErr),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _password,
            focusNode: _passwordFocus,
            obscureText: _hide,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.newPassword],
            onChanged: (_) => setState(() {}),
            onSubmitted: (_) => _sendCode(),
            decoration: InputDecoration(
              errorText: _passwordErr,
              labelText: 'Password',
              prefixIcon: const Icon(Icons.lock_outline),
              suffixIcon: IconButton(
                onPressed: () => setState(() => _hide = !_hide),
                tooltip: _hide ? 'Show password' : 'Hide password',
                icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined),
              ),
            ),
          ),
        ],
      ),
    ),
    const SizedBox(height: 10),
    _rule(_password.text.length >= 6, '6 or more letters or numbers'),
    if (_error != null) ...[const SizedBox(height: 14), AuthError(_error!)],
    const SizedBox(height: 22),
    BigButton(label: 'Create my free account', busy: _busy, onPressed: _sendCode),
    const SizedBox(height: 12),
    const Text('We will email you a 6-digit code to check the email is yours.', textAlign: TextAlign.center, style: TextStyle(fontSize: 12.5, color: Brand.muted, height: 1.4)),
  ]);

  Widget _rule(bool ok, String text) => Row(
    children: [
      Icon(ok ? Icons.check_circle : Icons.radio_button_unchecked, size: 17, color: ok ? Brand.blue : Brand.faint),
      const SizedBox(width: 6),
      Expanded(child: Text(text, style: TextStyle(fontSize: 13, color: ok ? Brand.textSoft : Brand.muted))),
    ],
  );

  // ── Step 3: the code ──

  Widget _codeStep() => _scroll([
    AuthPicture('code', aspect: 360 / 150, maxHeight: (_pictureHeight * 0.85).clamp(84.0, 150.0)),
    const SizedBox(height: 16),
    const Text('Enter the code', style: TextStyle(fontSize: 25, fontWeight: FontWeight.w700, letterSpacing: -0.4, color: Brand.navy)),
    const SizedBox(height: 6),
    Text.rich(
      TextSpan(
        style: const TextStyle(fontSize: 15, color: Brand.textSoft, height: 1.45),
        children: [
          const TextSpan(text: 'We emailed a 6-digit code to '),
          TextSpan(
            text: _email.text.trim(),
            style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.text),
          ),
          const TextSpan(text: '. It works for 10 minutes. Check spam if you do not see it.'),
        ],
      ),
    ),
    const SizedBox(height: 22),
    CodeBoxes(
      controller: _code,
      enabled: !_busy,
      error: _codeWrong,
      onChanged: (_) => setState(() {
        _codeWrong = false;
        _error = null;
      }),
      onCompleted: (_) => _create(),
    ),
    if (_error != null) ...[const SizedBox(height: 14), AuthError(_error!)],
    const SizedBox(height: 22),
    BigButton(label: 'Create account', busy: _busy, onPressed: _code.text.trim().length == CodeBoxes.length ? _create : null),
    const SizedBox(height: 8),
    Wrap(
      alignment: WrapAlignment.spaceBetween,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        TextButton.icon(onPressed: _busy ? null : () => _go(1), icon: const Icon(Icons.edit_outlined, size: 18), label: const Text('Change email')),
        TextButton.icon(
          onPressed: _busy || _resendIn > 0 ? null : _sendCode,
          icon: const Icon(Icons.refresh, size: 18),
          label: Text(_resendIn > 0 ? 'Send again in ${_resendIn}s' : 'Send a new code'),
        ),
      ],
    ),
  ]);
}
