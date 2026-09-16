module.exports = function (app) {
  const plugin = {
    id: 'signalk-race-plan',
    name: 'Race Plan',
    description: 'Leg table for the active route (webapp at /signalk-race-plan/)'
  }

  plugin.schema = {
    type: 'object',
    properties: {}
  }

  plugin.start = function () {
    app.setPluginStatus('Webapp available at /signalk-race-plan/')
  }

  plugin.stop = function () {}

  return plugin
}
