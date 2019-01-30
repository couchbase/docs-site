#!/bin/env groovy

def awsCredentialsId = 'couchbase-prod-aws'
def cfDistributionId = 'E2RGKCBK9HN257'
def githubApiTokenCredentialsId = 'docs-robot-api-key'
def s3Bucket = 'docs.couchbase.com'

def awsCredentials = [$class: 'AmazonWebServicesCredentialsBinding', credentialsId: awsCredentialsId, accessKeyVariable: 'AWS_ACCESS_KEY_ID', secretKeyVariable: 'AWS_SECRET_ACCESS_KEY']
def githubApiTokenCredentials = string(credentialsId: githubApiTokenCredentialsId, variable: 'GITHUB_API_TOKEN')

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
    STAGE='production'
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
            pipelineTriggers([githubPush()]),
          ])
        }
      }
    }
    stage('Build') {
      steps {
        withCredentials([githubApiTokenCredentials]) {
          withEnv(["GIT_CREDENTIALS=https://${env.GITHUB_API_TOKEN}:@github.com"]) {
            sh 'antora --cache-dir=./.cache/antora --clean --pull $STAGE-antora-playbook.yml'
          }
        }
      }
    }
    stage('Publish') {
      steps {
        withCredentials([awsCredentials]) {
          sh "aws s3 cp public/ s3://${s3Bucket}/ --recursive --exclude '404.html' --exclude '_/font/*' --acl public-read --cache-control 'public,max-age=0,must-revalidate' --metadata-directive REPLACE --only-show-errors"
          sh "aws s3 cp public/_/font/ s3://${s3Bucket}/_/font/ --recursive --exclude '*' --include '*.woff' --acl public-read --cache-control 'public,max-age=604800' --content-type 'application/font-woff' --metadata-directive REPLACE --only-show-errors"
          sh "aws s3 cp public/_/font/ s3://${s3Bucket}/_/font/ --recursive --exclude '*' --include '*.woff2' --acl public-read --cache-control 'public,max-age=604800' --content-type 'font/woff2' --metadata-directive REPLACE --only-show-errors"
        }
      }
    }
  }
  post {
    failure {
      deleteDir()
    }
  }
}
