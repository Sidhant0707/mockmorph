// test-api.mjs
// Do not use process.env here. Paste the exact key from your AI Studio dashboard.
const API_KEY = "AIzaSyCs1Tn7lt9I4vzv3ga9e9-eHTTzH2WnWlI"; 

console.log("Pinging Google AI Studio Gateway...");

fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`)
  .then(res => res.json())
  .then(data => {
    if (data.error) {
      console.error("\n❌ API Gateway Rejected the Key:", data.error.message);
    } else if (data.models) {
      console.log("\n✅ SUCCESS! Your key has access to these models:");
      data.models.forEach(m => {
        if (m.name.includes('flash') || m.name.includes('pro')) {
          console.log(`- ${m.name.replace('models/', '')}`);
        }
      });
    } else {
      console.log("\n⚠️ Unknown response:", data);
    }
  })
  .catch(err => console.error("\n💥 Network Failure:", err));