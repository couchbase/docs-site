#!/bin/env groovy

def awsCredentialsId = 'couchbase-prod-aws'
def fontawesomeNpmTokenCredentialsId = 'fontawesome-npm-token'
def githubApiCredentialsId = 'docs-robot-github-token'
def sshPrivKeyCredentialsId = 'terraform-ssh-key'
def siteS3Bucket = 'docs.couchbase.com'
def infraProfile = 'prod'
def infraS3Bucket = 'docs.couchbase.com-terraform-backend'
def githubAccount = 'couchbase'
def githubRepo = 'docs-site'

def awsCredentials = [$class: 'AmazonWebServicesCredentialsBinding', credentialsId: awsCredentialsId, accessKeyVariable: 'AWS_ACCESS_KEY_ID', secretKeyVariable: 'AWS_SECRET_ACCESS_KEY']
def githubApiCredentials = usernamePassword(credentialsId: githubApiCredentialsId, usernameVariable: 'GITHUB_USERNAME', passwordVariable: 'GITHUB_TOKEN')
def fontawesomeNpmTokenCredentials = string(credentialsId: fontawesomeNpmTokenCredentialsId, variable: 'FONTAWESOME_NPM_TOKEN')

def triggerEventType
def s3Cmd = 'cp --recursive'

// Jenkins job configuration
// -------------------------
// Category: Multibranch Pipeline
// Pipeline name: docs.couchbase.com
// Branch Sources: Single repository & branch
// Name: master
// Source Code Management: Git
// Repository URL: https://github.com/couchbase/docs-site
// Credentials: - none -
// Refspec: +refs/heads/master:refs/remotes/origin/master
// Branch specifier: refs/heads/master
// Advanced clone behaviors: [ ] Fetch tags, [x] Honor refspec on initial clone, [x] Shallow clone (depth: 3)
// Polling ignores commits with certain messages: (?s).*\[skip ci\].*
// Build Configuration:
// Mode: by Jenkinsfile
// Script Path: Jenkinsfile
pipeline {
  agent {
    dockerfile {
      filename 'Dockerfile.jenkins'
      additionalBuildArgs '--build-arg GROUP_ID=$(id -g) --build-arg USER_ID=$(id -u)'
    }
  }
  environment {
    CI='true'
    ALGOLIA_APP_ID='NI1G57N08Q'
    ALGOLIA_API_KEY='d3eff3e8bcc0860b8ceae87360a47d54'
    ALGOLIA_INDEX_NAME='prod_docs_couchbase'
    FORCE_HTTPS='false' // CloudFront is configured to force http -> https
    NODE_OPTIONS='--max-old-space-size=4096'
    OPTANON_SCRIPT_URL = "https://cdn.cookielaw.org/scripttemplates/otSDKStub.js"
    OPTANON_SCRIPT_DATA_DOMAIN_SCRIPT = "748511ff-10bf-44bf-88b8-36382e5b5fd9"
    NODE_PATH='/usr/local/share/.config/yarn/global/node_modules'
    SHOW_FEEDBACK_BUTTON='true'
  }
  triggers {
    githubPush()
    cron('TZ=Etc/UTC\nH H(2-4) * * *')
  }
  options {
    buildDiscarder logRotator(artifactDaysToKeepStr: '60', artifactNumToKeepStr: '', daysToKeepStr: '60', numToKeepStr: '')
    disableConcurrentBuilds()
  }
  stages {
    stage('Configure') {
      steps {
        script {
          properties([[$class: 'GithubProjectProperty', projectUrlStr: "https://github.com/$githubAccount/$githubRepo"]])
          env.GIT_COMMIT = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
          triggerEventType = currentBuild.getBuildCauses('hudson.triggers.TimerTrigger$TimerTriggerCause').size() > 0 ? 'cron' : 'push'
          if (triggerEventType == 'cron' && Calendar.getInstance().get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY) {
            s3Cmd = 'sync --delete --exact-timestamps'
          }
        }
        withCredentials([awsCredentials]) {
          withEnv(sh(script: "aws s3 cp s3://$infraS3Bucket/$infraProfile/infra.conf -", returnStdout: true).trim().split("\n") as List) {
            script {
              // exposes environment variables to other stages
              env.WEB_PUBLIC_IP = env.WEB_PUBLIC_IP
              env.WEB_PUBLIC_URL = env.WEB_PUBLIC_URL
              env.CDN_DISTRIBUTION_ID = env.CDN_DISTRIBUTION_ID
            }
          }
        }
        withCredentials([fontawesomeNpmTokenCredentials]) {
          writeFile file: 'scripts/.npmrc', text: '@fortawesome:registry=https://npm.fontawesome.com/\n//npm.fontawesome.com/:_authToken=${FONTAWESOME_NPM_TOKEN}\n'
          sh '(cd scripts && npm --no-package-lock i >/dev/null || true)'
        }
      }
    }
    stage('Build') {
      steps {
        withCredentials([githubApiCredentials]) {
          withEnv(["GIT_CREDENTIALS=https://$env.GITHUB_TOKEN:@github.com"]) {
            sh "ls -ltr"
            sh "echo $GIT_CREDENTIALS > ~/.git-credentials"
            sh "mkdir -p ~/.ssh"
            sh "cp github.hostkey ~/.ssh/known_hosts"
            sh "rm -rf ./couchbase-cloud"
            sh "time git clone -v --depth 1 git@github.com:couchbasecloud/couchbase-cloud.git"
            sh "time antora --cache-dir=./.cache/antora --clean --extension=./lib/site-stats-extension.js --fetch --redirect-facility=nginx --stacktrace --url=$env.WEB_PUBLIC_URL antora-playbook.yml"
          }
        }
        sh 'node scripts/populate-icon-defs.js public'
        sh 'cat etc/nginx/snippets/rewrites.conf public/.etc/nginx/rewrite.conf | awk -F \' +\\\\{ +\' \'{ if ($1 && a[$1]++) { print sprintf("Duplicate location found on line %s: %s", NR, $0) > "/dev/stderr" } else { print $0 } }\' > public/.etc/nginx/combined-rewrites.conf'
      }
    }

    stage('Make Global Sitemap') {
      steps {
        sh '''
          SCRIPT_PATH="scripts/make-global-sitemap.sh"
          if [ -f "${SCRIPT_PATH}" ]; then
            ${SCRIPT_PATH} || echo "Script failed to run, but continue anyway"
          else
            echo "Skipping - script not found"
          fi
        '''
      }
    }

    stage('Publish') {
      steps {
        withCredentials([awsCredentials]) {
          script {
            def includeFilter = sh(script: 'find public -mindepth 1 -maxdepth 1 -type d -name [a-z_]\\* -printf %f\\\\0', returnStdout: true).trim().split('\0').sort().collect { "--include '$it/*'" }.join(' ')
            sh "aws s3 ${s3Cmd} public/ s3://$siteS3Bucket/ --exclude '*' ${includeFilter} --exclude '_/font/*' --acl public-read --cache-control 'public,max-age=0,must-revalidate' --metadata-directive REPLACE --only-show-errors"
            sh "aws s3 ${s3Cmd} public/ s3://$siteS3Bucket/ --exclude '*' --include 'global-sitemap.xml' --include 'sitemap*.xml' --include 'site-manifest.json' --include 'index.html' --include '404.html' --include 'robots.txt' --exclude '*/*' --acl public-read --cache-control 'public,max-age=0,must-revalidate' --metadata-directive REPLACE --only-show-errors"
          }
          // NOTE copy fonts again to fix content-type header
          sh "aws s3 cp public/_/font/ s3://$siteS3Bucket/_/font/ --recursive --exclude '*' --include '*.woff' --acl public-read --cache-control 'public,max-age=604800' --content-type 'application/font-woff' --metadata-directive REPLACE --only-show-errors"
          sh "aws s3 cp public/_/font/ s3://$siteS3Bucket/_/font/ --recursive --exclude '*' --include '*.woff2' --acl public-read --cache-control 'public,max-age=604800' --content-type 'font/woff2' --metadata-directive REPLACE --only-show-errors"
          sh "aws s3 cp public/.etc/nginx/combined-rewrites.conf s3://$siteS3Bucket/.rewrites.conf --metadata-directive REPLACE --only-show-errors"
          sh "aws s3api put-bucket-website --bucket $siteS3Bucket --website-configuration file://etc/s3/bucket-website.json"
          sshagent([sshPrivKeyCredentialsId]) {
            sh "ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no ubuntu@$env.WEB_PUBLIC_IP sudo update-nginx-rewrites"
          }
        }
      }
    }

    stage('Invalidate Cache') {
      steps {
        withCredentials([awsCredentials]) {
          sh "aws --output text cloudfront create-invalidation --distribution-id $env.CDN_DISTRIBUTION_ID --paths '/*'"
        }
      }
    }
  }
  post {
    success {
      githubNotify credentialsId: githubApiCredentialsId, account: githubAccount, repo: githubRepo, sha: env.GIT_COMMIT, context: 'continuous-integration/jenkins/push', description: 'The Jenkins CI build succeeded', status: 'SUCCESS'
    }
    failure {
      deleteDir()
      githubNotify credentialsId: githubApiCredentialsId, account: githubAccount, repo: githubRepo, sha: env.GIT_COMMIT, context: 'continuous-integration/jenkins/push', description: 'The Jenkins CI build failed', status: 'FAILURE'
    }
  }
}
