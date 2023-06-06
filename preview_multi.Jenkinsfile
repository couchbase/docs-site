#!/bin/env groovy

// Currently we use 2 different accounts. These have different secrets.
// The correct secret is selected later on once the pipeline knows which
// environment it is working on
def awsCredentialsIdDev = 'couchbase-dev-aws'
def awsCredentialsIdProd = 'couchbase-prod-aws'

def fontawesomeNpmTokenCredentialsId = 'fontawesome-npm-token'
def githubApiCredentialsId = 'docs-robot-github-token'

def sshPrivKeyCredentialsDev = 'terraform-ssh-key-dev'
def sshPrivKeyCredentialsProd = 'terraform-ssh-key'

def siteS3BucketDev = 'preview-docs.couchbase.com'
def siteS3BucketProd = 'docs.couchbase.com'

def infraProfileDev = 'preview'
def infraProfileProd = 'prod'

def infraS3BucketDev = '393559178215-terraform-backend'
def infraS3BucketProd = 'docs.couchbase.com-terraform-backend'

def githubAccount = 'couchbase'
def githubRepo = 'docs-site'

def githubApiCredentials = usernamePassword(credentialsId: githubApiCredentialsId, usernameVariable: 'GITHUB_USERNAME', passwordVariable: 'GITHUB_TOKEN')
def fontawesomeNpmTokenCredentials = string(credentialsId: fontawesomeNpmTokenCredentialsId, variable: 'FONTAWESOME_NPM_TOKEN')

def triggerEventType
def s3Cmd = 'cp --recursive'

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
    //// Disable cookie stuff until we resolve domain issue
    // OPTANON_SCRIPT_URL = "https://cdn.cookielaw.org/scripttemplates/otSDKStub.js"
    // OPTANON_SCRIPT_DATA_DOMAIN_SCRIPT = "748511ff-10bf-44bf-88b8-36382e5b5fd9"
    NODE_PATH='/usr/local/share/.config/yarn/global/node_modules'
    SHOW_FEEDBACK_BUTTON='true'
  }

  triggers {
    githubPush()
  }
  
  options {
    buildDiscarder logRotator(artifactDaysToKeepStr: '60', artifactNumToKeepStr: '', daysToKeepStr: '60', numToKeepStr: '')
    disableConcurrentBuilds()
  }

  parameters {
    //// Eventually use a single pipeline for both accounts, but for now only allow preview for testing
    //choice(name: 'environment', choices: "preview\narchive\nprod\nstaging", description: 'Environment to deploy to.')
    choice(name: 'environment', choices: "preview", description: 'Environment to deploy to.')
    string(name: 'branch', defaultValue: 'master', description: 'Git branch to use (tag or git sha accepted here too)')
    string(name: 'playbook', defaultValue: 'antora-playbook.yml', description: 'Antora playbook to apply')
    string(name: 'stage', defaultValue: '', description: '(Optional) Prefix/sub-directory to deploy docs to')
  }

  stages {
    stage('Checkout') {
      steps {
        script {
          // Sets a nice UI friendly build description on the left nav in jenkins
          currentBuild.description = "Env: ${params.environment}\nBranch: ${params.branch}\n Playbook: ${params.playbook}\nStage: ${params.stage}"
          sh("git checkout ${params.branch}")
        }

      }
    }

    stage('Configure') {
      steps {
        script {
          properties([[$class: 'GithubProjectProperty', projectUrlStr: "git@github.com:$githubAccount/$githubRepo"]])
          env.GIT_COMMIT = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
          
          //// Unused for preview, but leave for future merging for other environments
          // triggerEventType = currentBuild.getBuildCauses('hudson.triggers.TimerTrigger$TimerTriggerCause').size() > 0 ? 'cron' : 'push'
          // if (triggerEventType == 'cron' && Calendar.getInstance().get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY) {
          //   s3Cmd = 'sync --delete --exact-timestamps'
          // }
        }

        // Set account specific variables based on environment to deploy to
        script {
          env.awsCredentialsId="${params.environment == 'preview' ? awsCredentialsIdDev : awsCredentialsIdProd}"
          env.sshPrivKeyCredentialsId="${params.environment == 'preview' ? sshPrivKeyCredentialsDev : sshPrivKeyCredentialsProd}"
          env.siteS3Bucket="${params.environment == 'preview' ? siteS3BucketDev : siteS3BucketProd}"
          env.infraProfile="${params.environment == 'preview' ? infraProfileDev : infraProfileProd}"
          env.infraS3Bucket="${params.environment == 'preview' ? infraS3BucketDev : infraS3BucketProd}"

          // If a stage is passed, add trailing slash
          env.prefixDir="${params.stage == '' ? '' : params.stage+'/'}"
        }

        withCredentials([[
            $class: 'AmazonWebServicesCredentialsBinding', 
            accessKeyVariable: 'AWS_ACCESS_KEY_ID', 
            secretKeyVariable: 'AWS_SECRET_ACCESS_KEY',
            credentialsId: awsCredentialsId
        ]]) {
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
            sh "time antora --log-level=error --cache-dir=./.cache/antora --clean --extension=./lib/site-stats-extension.js --fetch --redirect-facility=nginx --stacktrace --url=$env.WEB_PUBLIC_URL ${params.playbook}"
          }
        }
        sh 'node scripts/populate-icon-defs.js public'
        sh 'cat etc/nginx/snippets/rewrites.conf public/.etc/nginx/rewrite.conf | awk -F \' +\\\\{ +\' \'{ if ($1 && a[$1]++) { print sprintf("Duplicate location found on line %s: %s", NR, $0) > "/dev/stderr" } else { print $0 } }\' > public/.etc/nginx/combined-rewrites.conf'
      }
    }
    stage('Publish') {
      steps {
        withCredentials([[
            $class: 'AmazonWebServicesCredentialsBinding', 
            accessKeyVariable: 'AWS_ACCESS_KEY_ID', 
            secretKeyVariable: 'AWS_SECRET_ACCESS_KEY',
            credentialsId: awsCredentialsId
        ]]) {
          script {
            def includeFilter = sh(script: 'find public -mindepth 1 -maxdepth 1 -type d -name [a-z_]\\* -printf %f\\\\0', returnStdout: true).trim().split('\0').sort().collect { "--include '$it/*'" }.join(' ')
            sh "aws s3 ${s3Cmd} public/ s3://$siteS3Bucket/${prefixDir} --exclude '*' ${includeFilter} --exclude '_/font/*' --acl public-read --cache-control 'public,max-age=0,must-revalidate' --metadata-directive REPLACE --only-show-errors"
            sh "aws s3 ${s3Cmd} public/ s3://$siteS3Bucket/${prefixDir} --exclude '*' --include 'sitemap*.xml' --include 'site-manifest.json' --include 'index.html' --include '404.html' --include 'robots.txt' --exclude '*/*' --acl public-read --cache-control 'public,max-age=0,must-revalidate' --metadata-directive REPLACE --only-show-errors"
          }
          // NOTE copy fonts again to fix content-type header
          sh "aws s3 cp public/_/font/ s3://$siteS3Bucket/${prefixDir}_/font/ --recursive --exclude '*' --include '*.woff' --acl public-read --cache-control 'public,max-age=604800' --content-type 'application/font-woff' --metadata-directive REPLACE --only-show-errors"
          sh "aws s3 cp public/_/font/ s3://$siteS3Bucket/${prefixDir}_/font/ --recursive --exclude '*' --include '*.woff2' --acl public-read --cache-control 'public,max-age=604800' --content-type 'font/woff2' --metadata-directive REPLACE --only-show-errors"
          sh "aws s3 cp public/.etc/nginx/combined-rewrites.conf s3://$siteS3Bucket/${prefixDir}.rewrites.conf --metadata-directive REPLACE --only-show-errors"
          sh "aws s3api put-bucket-website --bucket $siteS3Bucket --website-configuration file://etc/s3/bucket-website.json"
          sshagent([sshPrivKeyCredentialsId]) {
            sh "ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no ubuntu@$env.WEB_PUBLIC_IP sudo update-nginx-rewrites"
          }
        }
      }
    }
    stage('Invalidate Cache') {
      steps {
        withCredentials([[
            $class: 'AmazonWebServicesCredentialsBinding', 
            accessKeyVariable: 'AWS_ACCESS_KEY_ID', 
            secretKeyVariable: 'AWS_SECRET_ACCESS_KEY',
            credentialsId: awsCredentialsId
        ]]) {
          sh "aws --output text cloudfront create-invalidation --distribution-id $env.CDN_DISTRIBUTION_ID --paths '/*'"
        }
      }
    }
  }
  post {
    success {
      script {
        if (triggerEventType == 'cron') {
          build job: '/Antora/docs-search-indexer/master', wait: false
        }
      }
      githubNotify credentialsId: githubApiCredentialsId, account: githubAccount, repo: githubRepo, sha: env.GIT_COMMIT, context: 'continuous-integration/jenkins/push', description: 'The Jenkins CI build succeeded', status: 'SUCCESS'
    }
    failure {
      deleteDir()
      githubNotify credentialsId: githubApiCredentialsId, account: githubAccount, repo: githubRepo, sha: env.GIT_COMMIT, context: 'continuous-integration/jenkins/push', description: 'The Jenkins CI build failed', status: 'FAILURE'
    }
  }
}
