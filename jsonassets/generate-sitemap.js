#!/usr/bin/env node
/**
 * Generate sitemap.xml from content.json and static sections.
 * Usage: node jsonassets/generate-sitemap.js [--base=https://roamaxa.app]
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sitemapPath = path.join(projectRoot, 'sitemap.xml');
const contentPath = path.join(__dirname, 'content.json');

const argBase = process.argv.find(a=>a.startsWith('--base='));
const BASE = (argBase?argBase.split('=')[1]:'https://roamaxa.app').replace(/\/$/,'');

function parseDate(str){
  if(!str) return null;
  // Accept formats like 'August 13,2025' or ISO
  const fixed = str.replace(/,(\d{4})$/, ', $1');
  const d = new Date(fixed);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d){
  return d.toISOString().slice(0,10);
}

function xmlEscape(s){
  return s.replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&apos;' }[c]));
}

function urlEntry(loc, lastmod, changefreq, priority){
  return `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

function loadContent(){
  try {
    const raw = fs.readFileSync(contentPath,'utf8');
    return JSON.parse(raw);
  } catch(e){
    return [];
  }
}

function main(){
  const today = new Date();
  const todayStr = formatDate(today);
  const posts = loadContent();

  const staticSections = [
    { path: '/', changefreq:'daily', priority:'1.0', lastmod: todayStr },
    { path: '/#placesSection', changefreq:'weekly', priority:'0.9', lastmod: todayStr },
    { path: '/#eventsSection', changefreq:'daily', priority:'0.9', lastmod: todayStr },
    { path: '/#favoritesSection', changefreq:'monthly', priority:'0.7', lastmod: todayStr },
    { path: '/#downloadSection', changefreq:'monthly', priority:'0.6', lastmod: todayStr },
    { path: '/blog/', changefreq:'weekly', priority:'0.8', lastmod: todayStr }
  ];

  const entries = [];
  staticSections.forEach(s=>{
    entries.push(urlEntry(BASE + s.path, s.lastmod, s.changefreq, s.priority));
  });

  posts.forEach(p=>{
    if(!p.url) return;
    const d = parseDate(p.date) || today;
    const lastmod = formatDate(d);
    entries.push(urlEntry(BASE + p.url.replace(/\/$/,'/') , lastmod, 'monthly', '0.8'));
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generated: ${new Date().toISOString()} -->\n<!-- Run: node jsonassets/generate-sitemap.js --base=${BASE} -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;

  fs.writeFileSync(sitemapPath, xml, 'utf8');
  console.log('Sitemap written to', sitemapPath, 'with', entries.length, 'entries.');
}

if(require.main === module){
  main();
}
