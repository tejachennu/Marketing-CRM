import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/validate.dart';
import '../../ui/widgets.dart';
import 'auth_parts.dart';
import 'signup_screen.dart';

/// The first screen when signed out. Three faces:
/// - welcome: the picture, what the app does, "Create a free account" first (owner: sign-up first), Google, and a
///   link to sign in;
/// - sign in: email and password, forgot password, Google;
/// - name your business: the one step after a first "Continue with Google" (no workspace yet).
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, this.startOnSignIn = false});

  /// Open straight on the email and password form (demo screenshots).
  final bool startOnSignIn;
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

enum _Face { welcome, signIn, business }

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _business = TextEditingController();
  final _name = TextEditingController();
  final _passwordFocus = FocusNode();
  late _Face _face = widget.startOnSignIn ? _Face.signIn : _Face.welcome;
  String _phone = '';
  bool _busy = false;
  bool _googleBusy = false;
  bool _hide = true;
  bool _tried = false;
  bool _triedBusiness = false;
  String? _error;

  // After a first "Continue with Google": the name and email Google gave
  Map<String, dynamic>? _newAccount;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _business.dispose();
    _name.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  String? get _emailErr => _tried ? emailError(_email.text, required: true) : null;
  String? get _passwordErr => _tried && _password.text.isEmpty ? 'Enter your password.' : null;
  String? get _businessErr => _triedBusiness ? textError(_business.text, what: 'your business name', min: 2, max: 80) : null;
  String? get _phoneErr => _triedBusiness ? phoneError(_phone, required: true) : null;

  void _show(_Face face) => setState(() {
    _face = face;
    _error = null;
    _tried = false;
  });

  Future<void> _signIn() async {
    FocusScope.of(context).unfocus();
    setState(() => _tried = true);
    if (_emailErr != null || _passwordErr != null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AppScope.read(context).signIn(_email.text.trim(), _password.text);
    } catch (e) {
      if (mounted) setState(() => _error = friendlyAuthError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _google() async {
    setState(() {
      _googleBusy = true;
      _error = null;
    });
    try {
      final next = await AppScope.read(context).signInWithGoogle();
      if (next != null && mounted) {
        setState(() {
          _newAccount = next;
          _name.text = '${next['name'] ?? ''}';
          _face = _Face.business;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = friendlyAuthError(e));
    } finally {
      if (mounted) setState(() => _googleBusy = false);
    }
  }

  Future<void> _finishBusiness() async {
    FocusScope.of(context).unfocus();
    setState(() => _triedBusiness = true);
    if (_businessErr != null || _phoneErr != null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AppScope.read(context).finishGoogleSignUp(_business.text.trim(), _name.text.trim(), phone: _phone);
    } catch (e) {
      if (mounted) setState(() => _error = friendlyAuthError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _openSignup() => Navigator.push(context, MaterialPageRoute(builder: (_) => const SignupScreen()));

  @override
  Widget build(BuildContext context) {
    return PopScope(
      // Android back on the sign-in form returns to the welcome page instead of closing the app
      canPop: _face == _Face.welcome,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _face == _Face.signIn && !_busy) _show(_Face.welcome);
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 220),
            child: switch (_face) {
              _Face.welcome => _welcome(),
              _Face.signIn => _signInForm(),
              _Face.business => _businessForm(),
            },
          ),
        ),
      ),
    );
  }

  /// Centre the content on tablets; full width on phones.
  Widget _page({required Key key, required List<Widget> children, bool fill = false}) => LayoutBuilder(
    key: key,
    builder: (context, box) => SingleChildScrollView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(22, 8, 22, 20),
      child: Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: 440, minHeight: fill ? box.maxHeight - 28 : 0),
          child: fill
              ? IntrinsicHeight(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
                )
              : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
        ),
      ),
    ),
  );

  Widget _brandRow() => Row(
    children: [
      Image.asset('assets/app_icon.png', width: 36, height: 36),
      const SizedBox(width: 10),
      const Expanded(
        child: Text('WAMA CRM', overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Brand.navy, letterSpacing: -0.2)),
      ),
    ],
  );

  // ── Welcome ──

  Widget _welcome() {
    final height = MediaQuery.sizeOf(context).height;
    return _page(
      key: const ValueKey('welcome'),
      fill: true,
      children: [
        _brandRow(),
        const SizedBox(height: 10),
        AuthPicture('welcome', aspect: 360 / 250, maxHeight: (height * (height < 700 ? 0.28 : 0.34)).clamp(130.0, 300.0), semantic: 'A WhatsApp chat with a booking, a paid bill, a new order and a review'),
        const SizedBox(height: 14),
        const Text(
          'Your business on WhatsApp, in one app',
          style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, height: 1.18, letterSpacing: -0.5, color: Brand.navy),
        ),
        const SizedBox(height: 8),
        const Text(
          'Bookings, bills, your online store and customer chats, for salons, clinics, shops and any business.',
          style: TextStyle(color: Brand.textSoft, fontSize: 15, height: 1.42),
        ),
        const SizedBox(height: 14),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            const SoftPill(icon: Icons.card_giftcard_outlined, label: '14 days free'),
            const SoftPill(icon: Icons.credit_card_off_outlined, label: 'No card needed'),
            // Short phones: two pills, so the buttons stay in sight
            if (height >= 700) const SoftPill(icon: Icons.translate, label: 'English · తెలుగు · हिंदी'),
          ],
        ),
        const SizedBox(height: 20),
        const Spacer(),
        if (_error != null) ...[AuthError(_error!), const SizedBox(height: 12)],
        BigButton(label: 'Create a free account', icon: Icons.arrow_forward, onPressed: _googleBusy ? null : _openSignup),
        const SizedBox(height: 10),
        GoogleButton(onPressed: _google, busy: _googleBusy),
        const SizedBox(height: 6),
        Center(
          child: TextButton(
            onPressed: _googleBusy ? null : () => _show(_Face.signIn),
            style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
            child: const Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: 'Already have an account? ', style: TextStyle(color: Brand.textSoft, fontWeight: FontWeight.w500)),
                  TextSpan(text: 'Sign in', style: TextStyle(color: Brand.blue, fontWeight: FontWeight.w700)),
                ],
              ),
              textAlign: TextAlign.center,
            ),
          ),
        ),
        const TermsLine(),
      ],
    );
  }

  // ── Sign in ──

  Widget _signInForm() => _page(
    key: const ValueKey('signin'),
    children: [
      Align(
        alignment: Alignment.centerLeft,
        child: IconButton(
          onPressed: _busy ? null : () => _show(_Face.welcome),
          icon: const Icon(Icons.arrow_back),
          tooltip: 'Back',
          style: IconButton.styleFrom(backgroundColor: Brand.page),
        ),
      ),
      const SizedBox(height: 14),
      Align(alignment: Alignment.centerLeft, child: Image.asset('assets/app_icon.png', width: 60, height: 60)),
      const SizedBox(height: 18),
      const Text('Welcome back', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, letterSpacing: -0.5, color: Brand.navy)),
      const SizedBox(height: 6),
      const Text('Sign in to your business account.', style: TextStyle(color: Brand.textSoft, fontSize: 15, height: 1.4)),
      const SizedBox(height: 24),
      AutofillGroup(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.next,
              autocorrect: false,
              autofillHints: const [AutofillHints.email, AutofillHints.username],
              onChanged: (_) => _tried ? setState(() {}) : null,
              onSubmitted: (_) => _passwordFocus.requestFocus(),
              decoration: InputDecoration(labelText: 'Email', prefixIcon: const Icon(Icons.mail_outline), errorText: _emailErr),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _password,
              focusNode: _passwordFocus,
              obscureText: _hide,
              textInputAction: TextInputAction.done,
              autofillHints: const [AutofillHints.password],
              onChanged: (_) => _tried ? setState(() {}) : null,
              onSubmitted: (_) => _signIn(),
              decoration: InputDecoration(
                labelText: 'Password',
                prefixIcon: const Icon(Icons.lock_outline),
                errorText: _passwordErr,
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
      Align(
        alignment: Alignment.centerRight,
        child: TextButton(onPressed: () => openWebsitePage(context, '/forgot-password'), child: const Text('Forgot password?')),
      ),
      if (_error != null) ...[const SizedBox(height: 4), AuthError(_error!), const SizedBox(height: 12)] else const SizedBox(height: 8),
      BigButton(label: 'Sign in', busy: _busy, onPressed: _googleBusy ? null : _signIn),
      const SizedBox(height: 18),
      const Row(
        children: [
          Expanded(child: Divider(color: Brand.line)),
          Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('or', style: TextStyle(color: Brand.muted))),
          Expanded(child: Divider(color: Brand.line)),
        ],
      ),
      const SizedBox(height: 18),
      GoogleButton(onPressed: _busy ? null : _google, busy: _googleBusy),
      const SizedBox(height: 14),
      Center(
        child: TextButton(
          onPressed: _busy || _googleBusy ? null : _openSignup,
          child: const Text.rich(
            TextSpan(
              children: [
                TextSpan(text: 'New here? ', style: TextStyle(color: Brand.textSoft, fontWeight: FontWeight.w500)),
                TextSpan(text: 'Create a free account', style: TextStyle(color: Brand.blue, fontWeight: FontWeight.w700)),
              ],
            ),
            textAlign: TextAlign.center,
          ),
        ),
      ),
    ],
  );

  // ── Name your business (first Google sign-in) ──

  Widget _businessForm() {
    final email = '${_newAccount?['email'] ?? ''}';
    return _page(
      key: const ValueKey('business'),
      children: [
        const SizedBox(height: 8),
        AuthPicture('signup', aspect: 360 / 176, maxHeight: (MediaQuery.sizeOf(context).height * 0.22).clamp(110.0, 180.0)),
        const SizedBox(height: 18),
        const Text('Name your business', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, letterSpacing: -0.5, color: Brand.navy)),
        const SizedBox(height: 6),
        Text(
          email.isEmpty ? 'One last step. Your 14-day free trial starts now.' : 'One last step. Your 14-day free trial starts now for $email.',
          style: const TextStyle(color: Brand.textSoft, fontSize: 15, height: 1.4),
        ),
        const SizedBox(height: 22),
        TextField(
          controller: _business,
          autofocus: true,
          textCapitalization: TextCapitalization.words,
          textInputAction: TextInputAction.next,
          onChanged: (_) => _triedBusiness ? setState(() {}) : null,
          decoration: InputDecoration(labelText: 'Business name', hintText: 'e.g. Sri Lakshmi Fashions', prefixIcon: const Icon(Icons.storefront_outlined), errorText: _businessErr),
        ),
        const SizedBox(height: 14),
        PhoneField(value: _phone, label: 'Mobile number', errorText: _phoneErr, onChanged: (v) => setState(() => _phone = v)),
        const SizedBox(height: 14),
        TextField(
          controller: _name,
          textCapitalization: TextCapitalization.words,
          textInputAction: TextInputAction.done,
          decoration: const InputDecoration(labelText: 'Your name', prefixIcon: Icon(Icons.person_outline)),
          onSubmitted: (_) => _finishBusiness(),
        ),
        if (_error != null) ...[const SizedBox(height: 14), AuthError(_error!)],
        const SizedBox(height: 20),
        BigButton(label: 'Start my free trial', busy: _busy, onPressed: _finishBusiness),
        const SizedBox(height: 12),
        const Text('No card needed. You pay only if you choose a plan after the trial.', textAlign: TextAlign.center, style: TextStyle(fontSize: 12.5, color: Brand.muted, height: 1.4)),
      ],
    );
  }
}
