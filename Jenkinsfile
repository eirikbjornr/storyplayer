@Library("rd-apmm-groovy-ci-library@v1.x") _

pipeline {
  agent {
    dockerfile {
      label 'apmm-slave'
      args '-v /etc/pki:/etc/pki'
    }
  }

  environment {
    // Jenkins sets the container user to `jenkins`. In the absence of a real
    // user with a real home dir, npm looks for startup files (e.g. .npmrc)
    // under /, which causes the container to bomb out with a permissions
    // error.  Setting $HOME fixes this.
    HOME = "$PWD"
    http_proxy = "http://www-cache.rd.bbc.co.uk:8080"
    https_proxy = "http://www-cache.rd.bbc.co.uk:8080"
    NODE_ENV = "production"
    GIT_SSH_COMMAND = 'ssh -o ProxyCommand="nc -x socks-gw.rd.bbc.co.uk -X 5 %h %p"'
  }

  stages {
    stage('Discover package versions') {
      steps {
        script {
          env.package_name = sh(returnStdout: true, script: '''node -p "require('./package.json').name"''')
          env.git_version = sh(returnStdout: true, script: '''node -p "require('./package.json').version"''')

          withCredentials([string(credentialsId: 'npm-auth-token', variable: 'NPM_TOKEN')]) {
            env.npm_version = sh(returnStdout: true, script: '''
              # the only way I could find to temporarily set up token auth for the private registry
              echo //registry.npmjs.org/:_authToken=$NPM_TOKEN >> .npmrc
              npm show "$package_name" --reg https://registry.npmjs.org/ version || echo 0.0.0
              sed -i '$ d' .npmrc
            ''')
          }

          withBBCRDJavascriptArtifactory {
            env.artifactory_version = sh(returnStdout: true, script: 'npm show "$package_name" version --reg "https://artifactory.virt.ch.bbc.co.uk/artifactory/api/npm/cosmos-npm/" || echo 0.0.0')
          }

          println """
                    |----------------
                    |-- BUILD INFO --
                    |----------------
                    |
                    |Package name:        ${package_name}
                    |Git version:         $git_version
                    |NPM version:         $npm_version
                    |Artifactory version: $artifactory_version""".stripMargin()
        }
      }
    }
    stage('Publish to NPMjs Private') {
      when { not { equals expected: env.git_version, actual: env.npm_version } }
      steps {
        withCredentials([string(credentialsId: 'npm-auth-token', variable: 'NPM_TOKEN')]) {
          env.npm_version = sh(returnStdout: true, script: '''
            echo //registry.npmjs.org/:_authToken=$NPM_TOKEN >> .npmrc
            npm publish
            sed -i '$ d' .npmrc
          ''')
        }
      }
    }
    stage('Publish to Artifactory Private') {
      when { not { equals expected: env.git_version, actual: env.artifactory_version } }
      steps {
        withBBCRDJavascriptArtifactory {
          sh '# npm publish --reg ${artifactory} --_auth=${artifactory_auth}'
          withBBCGithubSSHAgent {
            sh '''
              git config --global user.name "Jenkins"
              git config --global user.email jenkins-slave@rd.bbc.co.uk
              git clone git@github.com:bbc/rd-ux-storyplayer-harness.git
              git clone git@github.com:bbc/rd-ux-storyformer.git
            '''

            dir('rd-ux-storyplayer-harness') {
              sh '''
                yarn add --registry https://artifactory.virt.ch.bbc.co.uk/artifactory/api/npm/cosmos-npm --dev --ignore-scripts @bbc/storyplayer
                git add package.json yarn.lock
                git commit -m "chore: Bumped storyplayer to version ${git_version}"
                git fetch origin
                git rebase origin/master
                git push origin master
              '''
            }

            dir('rd-ux-storyformer') {
              sh '''
                yarn add --registry https://artifactory.virt.ch.bbc.co.uk/artifactory/api/npm/cosmos-npm --dev --ignore-scripts @bbc/storyplayer
                git add package.json yarn.lock
                git commit -m "chore: Bumped storyplayer to version ${git_version}"
                git fetch origin
                git rebase origin/master
                git push origin master
              '''
            }
          }
        }
      }
    }
  }
  post {
    always {
      cleanWs()
    }
  }
}
