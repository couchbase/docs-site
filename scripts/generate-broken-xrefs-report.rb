# Summary: Scans the generated site for broken xrefs and generates a report of the xrefs by source file.
#
# Prerequisites: Ruby 2.5 (command: ruby)
#
# Usage:
#
# To run the script, first generate the full staging or production site into the public/ folder.
#
#  $ antora --clean --pull staging-antora-playbook.yml
#
# Then, run this script using the ruby command:
#
#  $ ruby scripts/generate-broken-xrefs-report.rb
#
# The script will generate a date-stamped, broken xrefs report in AsciiDoc format in the reports/ folder.
# You can view this report using the Asciidoctor browser extension or convert it to HTML or PDF using Asciidoctor.

Dir.chdir File.join __dir__, '..'

require 'date'
require 'set'

OUTPUT_FILENAME_GLOB = '**/*.html'
DATESTAMP = DateTime.now.strftime '%Y-%m-%d'

BrokenXrefRx = /<a href="#">([^>]+\.adoc)(#[^<]+)?<\/a>/
EditLinkRx = /<a href="([^"]+)" title="Edit this Page">Edit<\/a>/
EditUrlRx = /.*\/modules\/([^\/]+)\/pages\/(.+)/
PageIdRx = /^(.+?)@(.+?):(.+?):(.+?\.adoc)$/

LF = ?\n

# FIXME it would be better if the page ID were located somewhere in the output file
def derive_source_id output_filename, edit_url
  component, version, path = output_filename.split '/', 3
  if edit_url
    _, mod, path = (edit_url.match EditUrlRx).to_a
  else
    if component == 'server'
      mod, path = path.split '/', 2
    else
      mod = 'ROOT'
    end
    path = path.sub '.html', '.adoc'
  end
  %(#{version}@#{component}:#{mod}:#{path})
end

broken_xrefs = Dir.chdir 'public' do
  Dir[OUTPUT_FILENAME_GLOB].reduce({}) do |accum, output_filename|
    source_filename = nil
    edit_url = nil
    File.foreach output_filename do |line|
      if line.include? '"tool edit"'
        edit_url = (line.match EditLinkRx)[1]
      elsif line.include? '="#"'
        source_filename = derive_source_id output_filename, edit_url
        line.scan BrokenXrefRx do |(id, fragment)|
          (accum[source_filename] ||= Set.new) << id
        end
      end
    end
    accum
  end
end

report = <<~EOS
= Broken Xrefs Report: #{DATESTAMP}
ifndef::backend-pdf[]
:toc: macro
:toc-title: Component Versions
endif::[]
ifdef::backend-pdf[]
:notitle:
:nofooter:

[discrete]
= {doctitle}
endif::[]

[discrete]
== Overview

Total Pages Affected:: #{broken_xrefs.size}
Total Broken Xrefs:: #{broken_xrefs.reduce(0) {|accum, (_, xrefs)| accum += xrefs.size }}

toc::[]

EOS

broken_xrefs_by_component_version = broken_xrefs.reduce({}) do |accum, (id, xrefs)|
  _, version, component, mod, path = (PageIdRx.match id).to_a
  component_version = %(#{component} #{version})
  source_path = %(modules/#{mod}/pages/#{path})
  (accum[component_version] ||= {})[source_path] = xrefs
  accum
end

broken_xrefs_by_component_version.sort.to_h.each do |component_version, data|
  report += %(== #{component_version}#{LF}#{LF})
  report += %(|===\n| Source Path | Xref Target#{LF}#{LF})
  data.sort.to_h.each do |source_path, xrefs|
    report += %(| #{source_path}#{LF}a|#{LF}[%hardbreaks]#{LF}#{xrefs.to_a.join LF}#{LF}#{LF})
  end
  report = report.rstrip + LF
  report += %(|===#{LF}#{LF})
end

Dir.mkdir 'reports' unless Dir.exist? 'reports'
IO.write %(reports/broken-xrefs-report-#{DATESTAMP.tr '-', ''}.adoc), report.rstrip + LF
