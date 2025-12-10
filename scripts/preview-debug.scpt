property theSubject : "Preview debug report"
property BodyText : "See attached preview debug report"
property theName : "Hakim Cassimally"
property theEmail : "hakim.cassimally@couchbase.com"

property att1: "/preview/debug.log"
property att2: "/preview/doctor/antora-playbook.json"
property att3: "/preview/doctor/tree.html"

on run argv
    set pwd to (do shell script "pwd")

    set att1 to (pwd & att1) as POSIX file --convert to posix file
    set att2 to (pwd & att2) as POSIX file
    set att3 to (pwd & att3) as POSIX file

    tell application "/Applications/Microsoft Outlook.app"
        set theMsg to make new outgoing message
        set subject of theMsg to theSubject
        set plain text content of theMsg to BodyText

        tell theMsg
            make new attachment with properties {file:att1}
            make new attachment with properties {file:att2}
            make new attachment with properties {file:att3}
        end tell

        make new to recipient at theMsg with properties {email address:{name:theName, address:theEmail}}
        open theMsg
        activate
    end tell
end run


