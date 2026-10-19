Pod::Spec.new do |s|
  s.name           = 'BinauralTone'
  s.version        = '1.0.0'
  s.summary        = 'The binaural tone of 集中 mode, made on the phone'
  s.description    = 'The binaural tone of 集中 mode, made on the phone (local Expo module)'
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
