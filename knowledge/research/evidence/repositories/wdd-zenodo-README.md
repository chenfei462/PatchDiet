# Artifact for "WDD: Weighted Delta Debugging"

## Introduction

Thank you for evaluating this artifact! A copy of the preprint of the paper is available [here](https://zxt5.github.io/papers/wdd-icse25.pdf). This artifact applies for the avaiable and reusable badges.

To evaluate this artifact, a Linux machine with [docker](https://docs.docker.com/get-started/get-docker/) installed is needed.

## List of Claims Supported by the Artifact

- WDD introduces the concept of weight to the classical delta debugging algorithms, supporting more rational partitioning strategy during delta debugging.
- The probability of elements being deleted is negatively correlated with their weights in ddmin executions in both HDD and Perses, to varying degrees.
- Wddmin and WProbDD, the implementations of WDD in ddmin and ProbDD, outperform ddmin and ProbDD respectively, in both efficiency and effectiveness in two state-of-the-art tree-based test input minimization techniques, i.e. HDD and Perses.

## Getting Started

1. If docker is not installed, install it by following the [instructions](https://docs.docker.com/get-started/get-docker/).
2. Download and extract wdd-artifact.tar.gz `tar zxf wdd-artifact.tar.gz`
3. Change to the wdd-artifact directory `cd ./wdd-artifact`

### Notes

- All the experiments take very long time to finish, so it is recommended to use tools like screen and tmux to manage sessions if the experiments are run on remote server.
- The experiments involving ProbDD in this paper were repeated 5 times to mitigate the randomness of ProbDD algorithms.
- The evaluation results (especially for the time) may not exactly the same as shown in the paper due to the environmental differences. However, the deviation should be trivial, and the results should still support the original claims in the paper.


## Docker Environment Setup

1. Install the docker image.
   ```shell
   docker pull wddartifact/wdd:latest
   ```
2. Start a container
   ```shell
   docker container run --cap-add SYS_PTRACE --interactive --tty wddartifact/wdd:latest /bin/bash
   # for all operations in docker, use 'sudo' when meeting permission denied issues, password is 123
   cd /tmp/WeightDD/ # go to the directory for evaluation
   ```

## Benchmark Suites
Under the root directory of the project, the benchmarks are located in:

- `c_benchmarks`: benchmark-C which consists of 32 C programs;
- `xml_benchmarks`: benchmark-XML which consists of 30 XML files.

**Note:** When evaluating the RQs, finish processing all the benchmarks should takes **very long** time. It is recommended to try the demo benchmarks first to check the environment is setup properly. The demo benchmarks are located in `c_demo_benchmarks` and `xml_demo_benchmarks`, each containing several cases picked up from the whole benchmarks suites.


## RQ1: Element Weight v.s. Deletion Probability Correlation
**Note:** Three pre-build JAR files located in `/tmp/binaries/` are needed to run the evaluation:
```shell
> tree /tmp/binaries/
/tmp/binaries/
|-- perses_deploy.jar
|-- perses_stat_deploy.jar
`-- token_counter_deploy.jar
```

Use Perses-ddmin and HDD-ddmin to minimize the C and XML benchmarks, and profile the weights of elements being removed and remained.


```shell
cd /tmp/WeightDD
# '-h': for usage help, -s': indicate the benchmarks, '-r': choose the reducers, '-o': the output directory, '-j': number of jobs running in parallel
# For C Benchmarks:
./run_stat_parallel_c.py -s c_benchmarks/* -r perses_ddmin_stat hdd_ddmin_stat -o stat_result_c -j 20
# For XML benchmarks:
./run_stat_parallel_xml.py -s xml_benchmarks/xml-* -r perses_ddmin_stat hdd_ddmin_stat -o stat_result_xml -j 20
```

After running each script, there should be a corresponding result folder generated, e.g. stat_result_c. Use the following commands to calculate the correlations used in the paper and export the results to csv files.

```shell
# Calculate the correlations and export the results into csv files
python3 stat.py -d ./stat_result_c/perses_ddmin_stat_0/ -o rq1_csv/perses_ddmin_c.csv -t correlation
python3 stat.py -d ./stat_result_c/hdd_ddmin_stat_0/ -o rq1_csv/hdd_ddmin_c.csv -t correlation
python3 stat.py -d ./stat_result_xml/perses_ddmin_stat_0/ -o rq1_csv/perses_ddmin_xml.csv -t correlation
python3 stat.py -d ./stat_result_xml/hdd_ddmin_stat_0/ -o rq1_csv/hdd_ddmin_xml.csv -t correlation
```

To exactly reproduce the Figure 4 in the paper, run the following command **(out of the docker container)** under the root directory of `wdd-artifact`. This python script visualizes the raw data under `./results_rq1_csv` in a box plot. This should be the only command that run out of the docker container.

```shell
python3 plot.py
```

## RQ2: Wddmin v.s. ddmin

Use Perses-ddmin, Perses-wddmin, HDD-ddmin, and HDD-wddmin to minimize the C and XML benchmarks.

```shell
# '-s': indicate the benchmarks, '-r': choose the reducers, '-o': the output directory, '-j': number of jobs running in parallel
# For C Benchmarks:
./run_exp_parallel_c.py -s c_benchmarks/* -r perses_ddmin perses_wdd hdd_ddmin hdd_wdd -o result_wdd_c -j 20
# For XML Benchmarks:
./run_exp_parallel_xml.py -s xml_benchmarks/xml-* -r perses_ddmin perses_wdd hdd_ddmin hdd_wdd -o result_wdd_xml -j 20
```
Export the results to csv files.

```shell
# Run convert_result_to_csv.py to export the results into csv files, use '-h' to see usage notes
./convert_result_to_csv.py -d result_wdd_c/hdd_ddmin_0/*  -o hdd_ddmin_c.csv
./convert_result_to_csv.py -d result_wdd_c/hdd_wdd_0/*  -o hdd_wdd_c.csv
./convert_result_to_csv.py -d result_wdd_c/perses_ddmin_0/*  -o perses_ddmin_c.csv
./convert_result_to_csv.py -d result_wdd_c/perses_wdd_0/*  -o perses_wdd_c.csv
./convert_result_to_csv.py -d result_wdd_xml/hdd_ddmin_0/*  -o hdd_ddmin_xml.csv
./convert_result_to_csv.py -d result_wdd_xml/hdd_wdd_0/*  -o hdd_wdd_xml.csv
./convert_result_to_csv.py -d result_wdd_xml/perses_ddmin_0/*  -o perses_ddmin_xml.csv
./convert_result_to_csv.py -d result_wdd_xml/perses_wdd_0/*  -o perses_wdd_xml.csv
```

## RQ3: WProbDD v.s. ProbDD

Use Perses-ProbDD, Perses-WProbDD, HDD-ProbDD, and HDD-WProbDD to minimize the C and XML benchmarks.

```shell
# '-s': indicate the benchmarks, '-r': choose the reducers, '-o': the output directory, '-j': number of jobs running in parallel
# For C Benchmarks:
./run_exp_parallel_c.py -s c_benchmarks/* -r perses_probdd perses_wprobdd hdd_probdd hdd_wprobdd -o result_wprobdd_c -j 20
# For XML Benchmarks:
./run_exp_parallel_xml.py -s xml_benchmarks/xml-* -r perses_probdd perses_wprobdd hdd_probdd hdd_wprobdd -o result_wprobdd_xml -j 20
```

Export the results to csv files.

```shell
# Run convert_result_to_csv.py to export the results into csv files, use '-h' to see usage notes
./convert_result_to_csv.py -d result_wprobdd_c/hdd_probdd_0/*  -o hdd_probdd_c.csv
./convert_result_to_csv.py -d result_wprobdd_c/hdd_wprobdd_0/*  -o hdd_wprobdd_c.csv
./convert_result_to_csv.py -d result_wprobdd_c/perses_probdd_0/* -o perses_probdd_c.csv
./convert_result_to_csv.py -d result_wprobdd_c/perses_wprobdd_0/* -o perses_wprobdd_c.csv
./convert_result_to_csv.py -d result_wprobdd_xml/hdd_probdd_0/*  -o hdd_probdd_xml.csv
./convert_result_to_csv.py -d result_wprobdd_xml/hdd_wprobdd_0/*  -o hdd_wprobdd_xml.csv
./convert_result_to_csv.py -d result_wprobdd_xml/perses_probdd_0/* -o perses_probdd_xml.csv
./convert_result_to_csv.py -d result_wprobdd_xml/perses_wprobdd_0/* -o perses_wprobdd_xml.csv
```

**Note**: the results generated by running the above commands may not be exactly equal to the results shown in the paper, due to the differences of the environments and computing resources. The raw data and the csv results used in the paper are located in `./results_c`, `./results_xml` and `./results_csv`.

