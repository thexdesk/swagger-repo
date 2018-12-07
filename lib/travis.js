const fetch = require('node-fetch');

async function updateBranchStatus(branch, commit, token) {
  const [owner, repo] = process.env.TRAVIS_REPO_SLUG.split('/');
  const url = `http://${owner}.github.io/${repo}/preview/${branch}/`;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/statuses/${commit}`, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'User-Agent': 'swagger-repo-travis'
    },
    body: JSON.stringify({
      state: 'success',
      target_url: url,
      description: 'Link to preview',
      context: 'Preview'
    })
  });

  if (!res.ok || res.status !== 201) {
    throw new Error(await res.text());
  }
}

async function hasDeployments(token) {
  const [owner, repo] = process.env.TRAVIS_REPO_SLUG.split('/');
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/deployments?task=deploy:docs-preview`,
    {
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': 'swagger-repo-travis'
      }
    }
  );

  if (!res.ok) return false;
  const resp = await res.json();
  return Array.isArray(resp) && resp.length > 1 && resp[0].id;
}

async function createDeployment(branch, token) {
  const existingDeployment = await hasDeployments(token);
  if (existingDeployment !== false) {
    return existingDeployment;
  }

  const [owner, repo] = process.env.TRAVIS_REPO_SLUG.split('/');
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/deployments`, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'User-Agent': 'swagger-repo-travis'
    },
    body: JSON.stringify({
      ref: branch,
      task: 'deploy:docs-preview',
      required_contexts: [],
      auto_merge: false,
      description: 'Reference Documentation Preview'
    })
  });

  if (!res.ok || res.status !== 201) {
    throw new Error(await res.text());
  }
  return (await res.json()).id;
}

async function setDeploymentStatus(id, branch, token) {
  const [owner, repo] = process.env.TRAVIS_REPO_SLUG.split('/');
  const url = `http://${owner}.github.io/${repo}/preview/${branch}/`;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/deployments/${id}/statuses`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': 'swagger-repo-travis'
      },
      body: JSON.stringify({
        state: 'success',
        target_url: url,
        description: 'Preview has been deployed'
      })
    }
  );

  if (!res.ok || res.status !== 201) {
    throw new Error(await res.text());
  }
}

async function updateDeployment(branch, token) {
  const id = await createDeployment(branch, token);
  await setDeploymentStatus(id, branch, token);
}


exports.notifyBranchPreviewFromTravis = async function(branch, commit) {
  try {
    try {
      await updateDeployment(branch, process.env.GH_TOKEN);
    } catch (e) {
      console.log('Failed to create Deployment status: ' + e.message);
      console.log('Fallback to Branch Status');
    }
    await updateBranchStatus(branch, commit, process.env.GH_TOKEN);
  } catch (e) {
    console.log('Failed to update branch status on GitHub:' + e.message);
  }
};
