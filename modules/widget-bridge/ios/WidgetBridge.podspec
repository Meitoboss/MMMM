Pod::Spec.new do |s|
  s.name           = 'WidgetBridge'
  s.version        = '1.0.0'
  s.summary        = 'Gives the home screen widget the state of the 集中 sound'
  s.description    = 'Gives the home screen widget the state of the 集中 sound (local Expo module)'
  s.author         = ''
  s.homepage       = 'https://github.com/Meitoboss/MMMM'
  s.license        = { :type => 'UNLICENSED' }
  s.source         = { git: '' }
  s.platforms      = { :ios => '16.0' }
  s.swift_version  = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,swift}'
end
