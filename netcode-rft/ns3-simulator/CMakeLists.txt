# CMakeLists.txt for NetCode-RFT NS-3 Simulation
set(NETCODE_SIM_SOURCES
    main-simulation.cc
    gf256.cc
    sha256.cc
    netcode-headers.cc
    rudp-application.cc
    rlnc-application.cc
)

build_exec(
    EXECNAME netcode-rft
    SOURCE_FILES ${NETCODE_SIM_SOURCES}
    LIBRARIES_TO_LINK
        ${libcore}
        ${libnetwork}
        ${libinternet}
        ${libpoint-to-point}
        ${libapplications}
        ${libnetanim}
    EXECUTABLE_DIRECTORY_PATH ${CMAKE_OUTPUT_DIRECTORY}/scratch/netcode-rft
)
