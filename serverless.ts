import type { AWS } from "@serverless/typescript";

import { appInfo } from "./src/functions";

const serverlessConfiguration: AWS = {
  service: "sls-appsync-test",
  frameworkVersion: "2",
  custom: {
    webpack: {
      webpackConfig: "./webpack.config.js",
      includeModules: true,
    },

    "appsync-simulator": {
      location: ".webpack/service",
    },

    defaultStage: "dev",

    cognitoStackName: "appsync-test-cognito",
    cognitoCfName: "${self:custom.cognitoStackName}-${self:provider.stage}",

    dynamodb: {
      stages: ["dev"],
      start: {
        port: 8000,
        inMemory: true,
        migrate: true, // DynamoDB Local 起動時にテーブルを作成する
        seed: true, // DynamoDB Local 起動時にシードデータを挿入する
      },
      seed: {
        dev: {
          sources: [
            {
              table: "${self:provider.stage}_task", // dev_taskというテーブル名を想定している
              sources: ["./migrations/tasks.json"],
            },
          ],
        },
      },
    },

    appSync: {
      name: "${self:provider.stage}_taskboard_backend",
      authenticationType: "AMAZON_COGNITO_USER_POOLS",
      userPoolConfig: {
        awsRegion: "ap-northeast-1",
        userPoolId: "${cf:${self:custom.cognitoCfName}.UserPoolId}",
        defaultAction: "ALLOW",
      },

      // スキーマファイル　複数指定することも可能
      schema: "schema.graphql",

      // データソース　今回は DynamoDB と Lambda を使用する
      dataSources: [
        // DynamoDB
        {
          type: "AMAZON_DYNAMODB",
          name: "${self:provider.stage}_task",
          description: "タスク管理テーブル",
          config: {
            tableName: {
              Ref: "DynamoDbTable",
            },
            serviceRoleArn: {
              "Fn::GetAtt": ["AppSyncDynamoDbServiceRole", "Arn"],
            },
            region: "ap-northeast-1",
          },
        },

        // Lambda
        {
          type: "AWS_LAMBDA",
          name: "${self:provider.stage}_appInfo",
          description: "Lambda Datasource for appInfo",
          config: {
            functionName: "appInfo",
            iamRoleStatements: [
              {
                Effect: "Allow",
                Action: ["lambda:invokeFunction"],
                Resource: ["*"],
              },
            ],
          },
        },
      ],

      // マッピングテンプレートファイルを格納しているディレクトリ
      mappingTemplatesLocation: "mapping-templates",
      mappingTemplates: [
        // アプリケーションの情報を取得する
        {
          dataSource: "${self:provider.stage}_appInfo", // dataSources で定義したデータソース名を指定
          type: "Query",
          field: "appInfo",
          request: "Query.appInfo.request.vtl",
          response: "Query.appInfo.response.vtl",
        },

        // タスク情報を１件取得する
        {
          type: "Query",
          field: "getTask",
          kind: "PIPELINE", // AppSync の関数を使ってパイプラインリゾルバを使う場合
          request: "start.vtl",
          response: "end.vtl",
          functions: [
            "getTask", // functionConfigurations で定義した関数名を指定
          ],
        },

        // タスク情報を複数件取得する
        {
          dataSource: "${self:provider.stage}_task",
          type: "Query",
          field: "listTasks",
          request: "Query.listTasks.request.vtl",
          response: "Query.listTasks.response.vtl",
        },

        // タスク情報を作成する
        {
          dataSource: "${self:provider.stage}_task",
          type: "Mutation",
          field: "createTask",
          request: "Mutation.createTask.request.vtl",
          response: "end.vtl",
        },

        // タスク情報を更新する
        {
          dataSource: "${self:provider.stage}_task",
          type: "Mutation",
          field: "updateTask",
          request: "Mutation.updateTask.request.vtl",
          response: "end.vtl",
        },

        // タスク情報を削除する
        {
          dataSource: "${self:provider.stage}_task",
          type: "Mutation",
          field: "deleteTask",
          request: "Mutation.deleteTask.request.vtl",
          response: "end.vtl",
        },
      ],

      // AppSyncの関数
      functionConfigurations: [
        {
          dataSource: "${self:provider.stage}_task",
          name: "getTask",
          request: "getTask.request.vtl",
          response: "getTask.response.vtl",
        },
      ],
    },
  },

  plugins: [
    "serverless-webpack",
    "serverless-appsync-plugin",
    "serverless-dynamodb-local",
    "serverless-appsync-simulator", // serverless-offline よりも上に記述する必要があります
    "serverless-offline",
  ],
  provider: {
    name: "aws",
    runtime: "nodejs12.x",
    region: "ap-northeast-1",
    logRetentionInDays: 3,
    apiGateway: {
      minimumCompressionSize: 1024,
      shouldStartNameWithService: true,
    },
    environment: {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
    },
    lambdaHashingVersion: "20201221",
  },

  // Lambda Function は通常の Serverless Framework の使い方と一緒
  functions: {
    appInfo,
  },

  resources: {
    Resources: {
      DynamoDbTable: {
        Type: "AWS::DynamoDB::Table",
        Properties: {
          TableName: "${self:provider.stage}_task",
          AttributeDefinitions: [
            {
              AttributeName: "id",
              AttributeType: "S",
            },
            {
              AttributeName: "status",
              AttributeType: "S",
            },
          ],
          KeySchema: [
            {
              AttributeName: "id",
              KeyType: "HASH",
            },
            {
              AttributeName: "status",
              KeyType: "RANGE",
            },
          ],
          ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5,
          },
        },
      },

      AppSyncDynamoDbServiceRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: "${self:provider.stage}-appsync-test-dynamodb-role",
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: {
                  Service: ["appsync.amazonaws.com"],
                },
                Action: ["sts:AssumeRole"],
              },
            ],
          },
          Policies: [
            {
              PolicyName: "${self:provider.stage}-appsync-test-dynamodb-policy",
              PolicyDocument: {
                Version: "2012-10-17",
                Statement: [
                  {
                    Effect: "Allow",
                    Action: [
                      "dynamodb:Query",
                      "dynamodb:BatchWriteItem",
                      "dynamodb:GetItem",
                      "dynamodb:DeleteItem",
                      "dynamodb:PutItem",
                      "dynamodb:Scan",
                      "dynamodb:UpdateItem",
                    ],
                    Resource: ["*"],
                  },
                ],
              },
            },
          ],
        },
      },
    },
  },
};

module.exports = serverlessConfiguration;
