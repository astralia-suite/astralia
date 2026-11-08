#!/usr/bin/env bash

_detect_gpu() {
    [[ -n "${gpus+x}" ]] && return 0
    gpus=$(lspci | grep -i 'VGA\|3D\|Display' || true)
    has_nvidia=false
    has_amd=false
    has_intel=false
    has_intel_xe=false
    grep -qi nvidia <<<"$gpus" && has_nvidia=true
    grep -qi 'amd\|radeon' <<<"$gpus" && has_amd=true
    grep -qi intel <<<"$gpus" && has_intel=true
    # Xe2 and later (Lunar Lake, Battlemage, Panther Lake) use the xe driver, not i915
    grep -qiE 'lunar ?lake|battlemage|panther ?lake' <<<"$gpus" && has_intel_xe=true
    return 0
}

_detect_cpu() { # sets cpu_ucode to the microcode package for this CPU ("" if unknown)
    case "$(awk -F': ' '/^vendor_id/ {print $2; exit}' /proc/cpuinfo)" in
    GenuineIntel) cpu_ucode=intel-ucode ;;
    AuthenticAMD) cpu_ucode=amd-ucode ;;
    *) cpu_ucode="" ;;
    esac
}
