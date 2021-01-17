const core = require("@actions/core");
const compareVersions = require("compare-versions");
const octokit = require("./octokit");
const { repo, owner, tagRegex, currentTag } = require("./context");
const rangedCommits = require("./commits");

/**
 * Fetch all the tags in the repository and check if they are
 * SemVer complaint, if so return the list of sorted tag versions.
 */
const releaseTags = async () => {
  core.info("fetch all tags in repository...");
  const tags = await octokit.paginate("GET /repos/:owner/:repo/tags", {
    owner,
    repo,
  });
  core.info(`fetched all ${tags.length} tags in repository.`);
  const releaseTags = tags.filter((tag) => compareVersions.validate(tag.name));
  core.info(`showing up to 10 last tags...`);
  releaseTags.slice(0, 10).forEach((release, index) => {
    core.info(`tag ${release.name}`);
  });
  return releaseTags;
};

/**
 * Based on the all the fetched releases, get the current and previous (if present) releases
 * and obtain their SHA so we could create a release commit range.
 */
const releaseCommitRange = async (releaseTags) => {
  core.info("fetch all releases...");
  const releases = releaseTags;
  core.info(`fetched all ${releases.length} releases.`);
  const currentReleaseIndex = findCurrentReleaseIndex(releases);
  core.info(`current release index: ${currentReleaseIndex}`);
  const toSHA = releases[currentReleaseIndex].commit.sha;
  core.info(`current release sha: "${toSHA}"`);
  const previousReleaseIndex = findPreviousReleaseIndex(
    releases,
    currentReleaseIndex
  );
  core.info(`previous release index: ${previousReleaseIndex}`);
  const fromSHA = await findBaseSha(previousReleaseIndex, releases, toSHA);
  core.info(`previous release sha: "${fromSHA}"`);
  return {
    releaseName: releases[currentReleaseIndex].name,
    fromSHA,
    toSHA,
  };
};

/**
 * If there is a `current-tag` option set then find the index of the provided tag.
 * Otherwise fallback to the first provided tag (0).
 */
function findCurrentReleaseIndex(releases) {
  if (currentTag == null) {
    return 0;
  } else {
    return releases.findIndex((release, _) =>
      release.name.includes(currentTag)
    );
  }
}

/**
 * If there is a `tag-regex` option set then perform a RegExp search while filtering release.
 * Otherwise just find a release with higher index than `currentReleaseIndex`.
 */
function findPreviousReleaseIndex(releases, currentReleaseIndex) {
  if (tagRegex == null) {
    return releases.findIndex((_, index) => index > currentReleaseIndex);
  } else {
    const versionRegExp = new RegExp(`${tagRegex}`, "g");
    return releases.findIndex(
      (release, index) =>
        index > currentReleaseIndex && release.name.match(versionRegExp) != null
    );
  }
}

/**
 * If there is no previous release (thus meaning there is only a 1 tag in the repository) then
 * set the base sha to the first commit in the repository.
 *
 * TODO: pagination if there is more than 100 commits from the first release to the base
 */
async function findBaseSha(releaseIndex, releases, endSHA) {
  if (releaseIndex == -1) {
    const commits = await octokit.repos.listCommits({
      repo,
      owner,
      sha: endSHA,
      per_page: 100,
    });
    //ignore initial commit
    return commits.data[commits.data.length - 1].sha;
  } else {
    return releases[releaseIndex].commit.sha;
  }
}

/**
 * Obtain the commit range, process it via jira issue finder and return the list of found JIRA
 * issues in the given range commit history.
 */
const commitHistory = async () => {
  const releases = await releaseTags();
  if (releases.length == 0) {
    throw Error("No tags found in this repository!");
  }
  const commitRange = await releaseCommitRange(releases);
  const commits = await rangedCommits(commitRange.fromSHA, commitRange.toSHA);
  return {
    commits,
    versionName: commitRange.releaseName,
  };
};

module.exports = commitHistory;
