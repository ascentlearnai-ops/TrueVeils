const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const supabase = require('../lib/supabase');

// Sign up
router.post('/signup', async (req, res) => {
  const { email, password, fullName, company } = req.body;

  try {
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError) throw authError;

    const { error: profileError } = await supabase.from('recruiters').insert({
      id: authData.user.id,
      email,
      full_name: fullName,
      company,
      plan: 'starter',
      interview_credits: 10
    });

    if (profileError) throw profileError;

    const token = jwt.sign(
      { id: authData.user.id, email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: authData.user.id, email, fullName, company } });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(400).json({ error: err.message || 'Signup failed' });
  }
});

// Sign in
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const { data: profile } = await supabase
      .from('recruiters')
      .select('*')
      .eq('id', data.user.id)
      .single();

    const token = jwt.sign(
      { id: data.user.id, email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: profile });
  } catch (err) {
    console.error('Login error:', err);
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

module.exports = router;
