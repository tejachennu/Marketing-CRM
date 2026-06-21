const fetchSitemap = async () => {
  try {
    const url = 'https://consularhelpdesk.com/sitemap.xml';
    console.log('Fetching sitemap:', url);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Content preview (first 1000 chars):');
    console.log(text.substring(0, 1000));
    
    // Extract locs
    const matches = [...text.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)];
    console.log('\nTotal loc tags found:', matches.length);
    console.log('First 10 urls:');
    matches.slice(0, 10).forEach((m, i) => console.log(`${i+1}: ${m[1].trim()}`));
  } catch (err) {
    console.error('Error:', err);
  }
};

fetchSitemap();
