// Simple login authentication
const loginForm = document.getElementById('loginForm');
const errorMessage = document.getElementById('errorMessage');

// Demo credentials
const DEMO_EMAIL = 'admin@st.com';
const DEMO_PASSWORD = '123';

loginForm.addEventListener('submit', function(e) {
    e.preventDefault();
    
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const loginBtn = document.querySelector('.login-btn');
    
    // Clear previous error message
    errorMessage.textContent = '';
    
    // Validate inputs
    if (!email || !password) {
        errorMessage.textContent = 'Please fill in all fields';
        return;
    }
    
    // Disable button during login
    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';
    
    // Simulate API call delay
    setTimeout(() => {
        // Check credentials
        if (email === DEMO_EMAIL && password === DEMO_PASSWORD) {
            // Store login state in localStorage
            localStorage.setItem('siboltech_user', JSON.stringify({
                email: email,
                loginTime: new Date().toISOString()
            }));
            
            // Redirect to index.html
            window.location.href = 'index.html';
        } else {
            // Show error
            errorMessage.textContent = 'Invalid email or password';
            loginBtn.disabled = false;
            loginBtn.textContent = 'Log In';
            document.getElementById('password').value = '';
        }
    }, 500);
});


