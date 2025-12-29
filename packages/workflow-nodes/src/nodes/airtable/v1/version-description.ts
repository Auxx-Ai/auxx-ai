// Temporarily commented out due to missing type imports
// TODO: Implement proper version description with simplified types

// export const versionDescription: INodeTypeDescription = {
//   displayName: 'Airtable',
//   name: 'airtable',
//   icon: 'file:airtable.svg',
//   group: ['input'],
//   version: [2, 2.1],
//   subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
//   description: 'Read, update, write and delete data from Airtable',
//   defaults: { name: 'Airtable' },
//   inputs: [NodeConnectionTypes.Main],
//   outputs: [NodeConnectionTypes.Main],
//   credentials: [
//     {
//       name: 'airtableTokenApi',
//       required: true,
//       displayOptions: { show: { authentication: ['airtableTokenApi'] } },
//     },
//     {
//       name: 'airtableOAuth2Api',
//       required: true,
//       displayOptions: { show: { authentication: ['airtableOAuth2Api'] } },
//     },
//   ],
//   properties: [
//     {
//       displayName: 'Authentication',
//       name: 'authentication',
//       type: 'options',
//       options: [
//         { name: 'Access Token', value: 'airtableTokenApi' },
//         { name: 'OAuth2', value: 'airtableOAuth2Api' },
//       ],
//       default: 'airtableTokenApi',
//     },
//     {
//       displayName: 'Resource',
//       name: 'resource',
//       type: 'options',
//       noDataExpression: true,
//       options: [
//         { name: 'Base', value: 'base' },
//         { name: 'Record', value: 'record' },
//       ],
//       default: 'record',
//     },
//   ],
// }
