#!/bin/env groovy

def awsCredentialsId = 'couchbase-prod-aws'
def cfDistributionId = 'E2RGKCBK9HN257'
def githubApiTokenCredentialsId = 'docs-robot-github-token'
def s3Bucket = 'docs.couchbase.com'

def awsCredentials = [$class: 'AmazonWebServicesCredentialsBinding', credentialsId: awsCredentialsId, accessKeyVariable: 'AWS_ACCESS_KEY_ID', secretKeyVariable: 'AWS_SECRET_ACCESS_KEY']
def githubApiTokenCredentials = usernamePassword(credentialsId: githubApiTokenCredentialsId, usernameVariable: 'GITHUB_USERNAME', passwordVariable: 'GITHUB_API_TOKEN')

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
// [x] Discard old items: Days to keep old items: 60
pipeline {
  agent {
    dockerfile {
      filename 'Dockerfile.jenkins'
    }
  }
  environment {
    ALGOLIA_APP_ID='NI1G57N08Q'
    ALGOLIA_API_KEY='d3eff3e8bcc0860b8ceae87360a47d54'
    ALGOLIA_INDEX_NAME='prod_docs_couchbase'
    FEEDBACK_BUTTON='true'
    FORCE_HTTPS='true'
    //NODE_OPTIONS='--max-old-space-size=8192'
    OPTANON_SCRIPT_URL='https://cdn.cookielaw.org/consent/288c1333-faac-4514-a8bf-a30b3db0ee32.js'
    STAGE='production'
  }
  triggers {
    githubPush()
  }
  options {
    disableConcurrentBuilds()
  }
  stages {
    stage('Configure') {
      steps {
        script {
          properties([
            [$class: 'GithubProjectProperty', projectUrlStr: 'https://github.com/couchbase/docs-site'],
          ])
          env.GIT_COMMIT = readFile('.git/HEAD').trim()
        }
      }
    }
    stage('Build') {
      steps {
        withCredentials([githubApiTokenCredentials]) {
          withEnv(["GIT_CREDENTIALS=https://${env.GITHUB_API_TOKEN}:@github.com"]) {
            //sh 'curl -sL --create-dirs -o .cache/antora/ui-bundle.zip https://github.com/couchbase/docs-ui/releases/download/v201/ui-bundle.zip'
            //sh 'antora --cache-dir=./.cache/antora --ui-bundle-url=./.cache/antora/ui-bundle.zip --clean --fetch --stacktrace $STAGE-antora-playbook.yml'
            sh 'antora --cache-dir=./.cache/antora --clean --fetch --stacktrace $STAGE-antora-playbook.yml'
          }
        }
      }
    }
    stage('Publish') {
      steps {
        withCredentials([awsCredentials]) {
          echo 'publish'
          //sh "aws s3 cp public/ s3://${s3Bucket}/ --recursive --exclude '404.html' --exclude '_/font/*' --acl public-read --cache-control 'public,max-age=0,must-revalidate' --metadata-directive REPLACE --only-show-errors"
          //sh "aws s3 cp public/_/font/ s3://${s3Bucket}/_/font/ --recursive --exclude '*' --include '*.woff' --acl public-read --cache-control 'public,max-age=604800' --content-type 'application/font-woff' --metadata-directive REPLACE --only-show-errors"
          //sh "aws s3 cp public/_/font/ s3://${s3Bucket}/_/font/ --recursive --exclude '*' --include '*.woff2' --acl public-read --cache-control 'public,max-age=604800' --content-type 'font/woff2' --metadata-directive REPLACE --only-show-errors"
        }
      }
    }
    stage('Invalidate Cache') {
      steps {
        withCredentials([awsCredentials]) {
          echo 'invalidate cache'
          //sh "aws --output text cloudfront create-invalidation --distribution-id ${cfDistributionId} --paths '/*'"
        }
      }
    }
  }
  post {
    success {
      githubNotify credentialsId: githubApiTokenCredentialsId, account: 'couchbase', repo: 'docs-site', sha: env.GIT_COMMIT, context: 'continuous-integration/jenkins/push', description: 'The Jenkins CI build succeeded', status: 'SUCCESS'
    }
    failure {
      deleteDir()
      githubNotify credentialsId: githubApiTokenCredentialsId, account: 'couchbase', repo: 'docs-site', sha: env.GIT_COMMIT, context: 'continuous-integration/jenkins/push', description: 'The Jenkins CI build failed', status: 'FAILURE'
    }
  }
}
