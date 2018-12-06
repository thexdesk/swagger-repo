const { execSync } = require('child_process');

exports.notifyBranchPreviewFromTravis = function(branch) {
  try {
    const [owner, repo] = process.env.TRAVIS_REPO_SLUG.split('/');
    const url = `http://${owner}.github.io/${repo}/preview/${branch}/`;
    execSync(
      `github-status-reporter --user ${owner} --repo ${repo} --branch ${branch} --state success --target-url="${url}" --description="Link to preview" --context "Preview"`,
      {
        GITHUB_TOKEN: process.env.GH_TOKEN,
        stdio: 'inherit'
      }
    );
    console.log('Set branch status on GitHub');
  } catch (e) {
    console.log('Failed to update branch status on GitHub');
  }
};
