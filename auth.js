// 1. Sign Up a new user
async function handleSignUp() {
  const email = document.getElementById('email-input').value;
  const password = document.getElementById('password-input').value;

  const { data, error } = await supabaseClient.auth.signUp({
    email: email,
    password: password,
  });

  if (error) {
    alert("Sign up failed: " + error.message);
  } else {
    alert("Success! Check your email to confirm your account (or try logging in).");
  }
}

// 2. Log In an existing user
async function handleSignIn() {
  const email = document.getElementById('email-input').value;
  const password = document.getElementById('password-input').value;

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: password,
  });

  if (error) {
    alert("Login failed: " + error.message);
  } else {
    // Send them to play.html once logged in!
    window.location.href = 'play.html';
  }
}

// 3. Log Out
async function handleSignOut() {
  await supabaseClient.auth.signOut();
  // Send them back to the home page
  window.location.href = 'index.html';
}