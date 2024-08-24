const functions = require('@google-cloud/functions-framework');
const { Storage } = require('@google-cloud/storage');

// Function to run Lighthouse audit on a given URL
async function runLighthouse(url) {
  const { launch } = await import('chrome-launcher');
  const chrome = await launch({
    chromePath: '.cache/puppeteer/chrome-headless-shell/linux-126.0.6478.63/chrome-headless-shell-linux64/chrome-headless-shell', // Path to the Chrome executable
    chromeFlags: ['--headless']
  });

  const lighthouse = await import('lighthouse');
  const options = {
    logLevel: 'info',
    output: 'json',
    port: chrome.port
  };
  const { lhr } = await lighthouse.default(url, options);

  return { lhr, chrome };
}

// Function to upload Lighthouse report to Cloud Storage
async function uploadReportToStorage(lhr) {
  const storage = new Storage();
  const bucket = storage.bucket('cp-workflowstest');
  const filename = `lighthouse-report-${Date.now()}.json`;
  //const reportBuffer = Buffer.from(JSON.stringify(lhr), 'utf8');
  const file = bucket.file(filename);

  await file.save(JSON.stringify(lhr), {
    contentType: 'application/json'
  });

  console.log(`Lighthouse report uploaded to: https://storage.googleapis.com/${bucket.name}/${filename}`);
}

// Remove images from the report
const removeScreenshots = (obj) => {
  for (const key in obj) {
    if (obj[key] && typeof obj[key] === 'object') {
      removeScreenshots(obj[key]);
    } else if (typeof key === 'string' && key.includes('screenshot')) {
      delete obj[key];
    }
  }

  // Additionally, remove specific filmstrip items
  if (obj.audits && obj.audits['screenshot-thumbnails']) {
    delete obj.audits['screenshot-thumbnails'];
  }
  if (obj.audits && obj.audits['filmstrip']) {
    delete obj.audits['filmstrip'];
  }

  if (obj.audits && obj.audits['final-screenshot']) {
    delete obj.audits['final-screenshot'];
  }

};

functions.http('helloHttp', async (req, res) => {
  const url = req.query.url;

  if (!url) {
    res.send(`Hello ${req.query.name || req.body.name || 'World'}!`);
    return;
  }

  let chrome;

  try {
    const { lhr, chromeInstance } = await runLighthouse(url);
    chrome = chromeInstance;
    await uploadReportToStorage(lhr);

    removeScreenshots(lhr);

    res.status(200).json(lhr);
  } catch (error) {
    console.error(error);
    if (chrome) {
      await chrome.kill();
    }
    res.status(500).send('An error occurred while running Lighthouse');
  } finally {
    if (chrome) {
      await chrome.kill();
    }
  }
});