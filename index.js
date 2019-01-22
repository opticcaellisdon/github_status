'use strict';

const octokit = require('@octokit/rest')();
const GITHUB_ACCESS_TOKEN = process.env.GITHUB_TOKEN;
const _ = require('lodash');

/**
 * Background Cloud Function to be triggered by cloud-builds Pub/Sub topic.
 *
 * @param {object} event The Cloud Functions event.
 */
exports.gcb_github = (event) => {
  const build = eventToBuild(event.data.data);
  return postBuildStatus(build);
};

// eventToBuild transforms pubsub event message to a build object.
const eventToBuild = (data) => {
  return JSON.parse(new Buffer(data, 'base64').toString());
}

function postBuildStatus(build) {
  octokit.authenticate({
    type: 'token',
    token: GITHUB_ACCESS_TOKEN
  });

  let repo = getRepo(build);
  if (repo === null || repo.site !== 'github') {
    return Promise.resolve();
  }
  let [ state, description ] = buildToGithubStatus(build);
  return octokit.repos.createStatus({
    owner: repo.user,
    repo: repo.name,
    sha: build.sourceProvenance.resolvedRepoSource.commitSha,
    state: state,
    description: description,
    context: 'gcb',
    target_url: build.logUrl
  });
}

function getRepo(build) {
  if ( build.source ) {
    let repoNameRe = /^(.*)_(.*)_(.*)$/;
    let repoName = build.source.repoSource.repoName;
    let match = repoNameRe.exec(repoName);
    if (!match) {
      console.error(`Cannot parse repoName: ${repoName}`);
      return null;
    }
    return {
      site: match[1],
      user: match[2],
      name: match[3]
    };
  } else {
    // Getting repo URL from the first step (the clone)
    const raw_repo = build.steps[4].args[1];
    // removing unnecessary parts and spliting by /
    const repo = raw_repo.match("git@(.*)\.com:(.*)/(.*)\.git");

    // Getting the commit from the second step (the checkout)
    _.set(build, "sourceProvenance.resolvedRepoSource.commitSha", build.steps[5].args[1]);
    return {
      site: repo[1],
      user: repo[2],
      name: repo[3]
    };
  }
}

function buildToGithubStatus(build) {
  let map = {
    QUEUED: ['pending', 'Build is queued'],
    WORKING: ['pending', 'Build is being executed'],
    FAILURE: ['error', 'Build failed'],
    INTERNAL_ERROR: ['failure', 'Internal builder error'],
    CANCELLED: ['failure', 'Build cancelled by user'],
    TIMEOUT: ['failure', 'Build timed out'],
    SUCCESS: ['success', 'Build finished successfully']
  }
  return map[build.status];
}
