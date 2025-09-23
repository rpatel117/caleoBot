const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🤖 Caleo Bot Setup\n');

const questions = [
  {
    key: 'appId',
    question: 'Enter your Azure App ID: ',
    required: true
  },
  {
    key: 'appPassword',
    question: 'Enter your Azure App Password: ',
    required: true
  },
  {
    key: 'companyName',
    question: 'Enter your company name: ',
    required: false,
    default: 'Your Company'
  },
  {
    key: 'websiteUrl',
    question: 'Enter your website URL: ',
    required: false,
    default: 'https://yourcompany.com'
  }
];

let answers = {};

function askQuestion(index) {
  if (index >= questions.length) {
    createConfigFiles();
    return;
  }

  const q = questions[index];
  const prompt = q.required ? q.question : `${q.question} (optional, default: ${q.default}): `;
  
  rl.question(prompt, (answer) => {
    if (q.required && !answer.trim()) {
      console.log('This field is required. Please try again.\n');
      askQuestion(index);
    } else {
      answers[q.key] = answer.trim() || q.default;
      askQuestion(index + 1);
    }
  });
}

function createConfigFiles() {
  console.log('\n📝 Creating configuration files...\n');

  // Create .env file
  const envContent = `# Microsoft App Registration
MICROSOFT_APP_ID=${answers.appId}
MICROSOFT_APP_PASSWORD=${answers.appPassword}

# Server Configuration
PORT=3978

# Ngrok URL (update this when running ngrok)
NGROK_URL=your_ngrok_url_here
`;

  fs.writeFileSync('.env', envContent);
  console.log('✅ Created .env file');

  // Update manifest.json
  const manifestPath = path.join('manifest', 'manifest.json');
  let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  
  manifest.id = answers.appId;
  manifest.developer.name = answers.companyName;
  manifest.developer.websiteUrl = answers.websiteUrl;
  manifest.developer.privacyUrl = `${answers.websiteUrl}/privacy`;
  manifest.developer.termsOfUseUrl = `${answers.websiteUrl}/terms`;
  manifest.bots[0].botId = answers.appId;
  manifest.webApplicationInfo.id = answers.appId;

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('✅ Updated manifest.json');

  console.log('\n🎉 Setup complete!\n');
  console.log('Next steps:');
  console.log('1. Run: npm install');
  console.log('2. Run: npm run dev');
  console.log('3. In another terminal: npm run ngrok');
  console.log('4. Update manifest.json with your ngrok URL');
  console.log('5. Side-load the app in Microsoft Teams');
  console.log('\n📖 See README.md for detailed instructions');

  rl.close();
}

// Start the setup process
askQuestion(0);
